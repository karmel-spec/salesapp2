import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getLeads, getLead, createLead, appendTimeline } from "@/lib/leads";
import { notifyTelegram, notifyArnoldWebhook } from "@/lib/arnold";
import { autoFolder } from "@/lib/folders";
import { config } from "@/lib/config";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PUBLIC_URL = (process.env.PUBLIC_BASE_URL || "https://blpsalesapp.netlify.app") + "/api/twilio/inbound";

/** Twilio request signature: base64 HMAC-SHA1 of URL + sorted form params. */
function validTwilioSignature(params: URLSearchParams, signature: string | null): boolean {
  if (!config.twilioAuthToken) return true; // unconfigured dev fallback
  if (!signature) return false;
  const data =
    PUBLIC_URL +
    [...params.keys()]
      .sort()
      .map((k) => k + params.get(k))
      .join("");
  const expected = crypto.createHmac("sha1", config.twilioAuthToken).update(data).digest("base64");
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const twiml = () =>
  new NextResponse('<?xml version="1.0" encoding="UTF-8"?><Response/>', {
    headers: { "Content-Type": "text/xml" },
  });

/**
 * Inbound SMS webhook for 801-769-0054. Logs the customer's reply on the
 * matching lead's timeline (making it "our turn") and pings the team on
 * Telegram. Always answers empty TwiML so Twilio sends no auto-reply.
 */
export async function POST(req: NextRequest) {
  const raw = await req.text();
  const params = new URLSearchParams(raw);
  if (!validTwilioSignature(params, req.headers.get("x-twilio-signature"))) {
    return NextResponse.json({ error: "Invalid Twilio signature" }, { status: 403 });
  }

  const from = params.get("From") || "";
  const body = (params.get("Body") || "").trim();
  const nMedia = parseInt(params.get("NumMedia") || "0", 10) || 0;
  if (!from || (!body && !nMedia)) return twiml();

  // Shop SMS gateway: technicians (matched on the Tech Phones tab) text
  // Store Map changes to this same number. The gateway answers with TwiML
  // for techs and returns PASS for everyone else, so customer replies fall
  // through to the lead pipeline below untouched.
  try {
    const gw = await fetch(
      (process.env.PUBLIC_BASE_URL || "https://blpsalesapp.netlify.app") + "/.netlify/functions/sms-inbound",
      { method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded",
          "x-internal-auth": crypto.createHash("sha256").update(config.twilioAuthToken || "").digest("hex") },
        body: raw });
    if (gw.ok && !gw.headers.get("x-sms-pass")) {
      return new NextResponse(await gw.text(), { headers: { "Content-Type": "text/xml" } });
    }
  } catch { /* gateway down: fall through to the lead pipeline */ }
  if (!body) return twiml();

  try {
    const { leads, shape } = await getLeads(true);
    const matches = leads.filter((l) => l.phoneDialable === from);
    // Prefer open leads, then the most recently touched.
    const lead =
      matches.find((l) => l.statusBucket === "new" || l.statusBucket === "active") ||
      matches.sort((a, b) => (b.lastTouchISO || "").localeCompare(a.lastTouchISO || ""))[0];

    if (lead) {
      await appendTimeline(
        lead,
        shape,
        {
          at: new Date().toISOString(),
          who: lead.name,
          kind: "inbound",
          source: "text",
          folder: autoFolder(lead.leadType, lead.headline, body),
          text: `📥 Customer texted: "${body}"`,
        },
        { touchLastContact: true }
      );
      notifyTelegram(
        `📥 <b>${lead.name} texted back</b> (${lead.headline || lead.leadType || "lead"}):\n"${body.slice(0, 400)}"\n→ It's our turn — reply from the Sales Console.`
      ).catch(() => {});
      // Wake Arnold: the reply makes his old draft stale — he rewrites it to
      // respond to what the customer actually said (still approval-gated).
      notifyArnoldWebhook({
        event: "inbound_reply",
        lead: { id: lead.id },
        note: `Customer replied by SMS: "${body.slice(0, 400)}". Replace any pending drafts for this lead with new ones that respond to this message.`,
      }).catch(() => {});
    } else {
      // Unknown texter — auto-create a Support contact so the message lands
      // in the General Inbox instead of only pinging Telegram.
      try {
        const digits = from.replace(/\D/g, "").slice(-10);
        const prettyPhone =
          digits.length === 10 ? `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}` : from;
        const id = await createLead({
          firstName: prettyPhone,
          phone: from,
          headline: body.slice(0, 90),
          source: "Texted the BLP Twilio line",
          inquiryMethod: "Text",
          status: "Support",
          capturedBy: "app",
        });
        const created = await getLead(id);
        if (created) {
          await appendTimeline(created.lead, created.shape, {
            at: new Date().toISOString(),
            who: prettyPhone,
            kind: "inbound",
            source: "text",
            folder: autoFolder("", "", body),
            text: `📥 Customer texted: "${body}"`,
          });
        }
        notifyTelegram(
          `💬 <b>New contact texted the BLP line</b> — ${prettyPhone} filed to the General Inbox.\n"${body.slice(0, 300)}"`
        ).catch(() => {});
      } catch {
        notifyTelegram(
          `📥 <b>Text from a number not in the Leads Log</b> (${from}):\n"${body.slice(0, 400)}"`
        ).catch(() => {});
      }
    }
  } catch {
    // Never bounce Twilio — the message would retry as an error loop.
  }
  return twiml();
}
