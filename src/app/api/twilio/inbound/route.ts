import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getLeads, appendTimeline } from "@/lib/leads";
import { notifyTelegram } from "@/lib/arnold";
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
  if (!from || !body) return twiml();

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
          text: `📥 Customer texted: "${body}"`,
        },
        { touchLastContact: true }
      );
      notifyTelegram(
        `📥 <b>${lead.name} texted back</b> (${lead.headline || lead.leadType || "lead"}):\n"${body.slice(0, 400)}"\n→ It's our turn — reply from the Sales Console.`
      ).catch(() => {});
    } else {
      notifyTelegram(
        `📥 <b>Text from a number not in the Leads Log</b> (${from}):\n"${body.slice(0, 400)}"`
      ).catch(() => {});
    }
  } catch {
    // Never bounce Twilio — the message would retry as an error loop.
  }
  return twiml();
}
