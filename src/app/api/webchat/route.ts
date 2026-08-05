import { NextRequest, NextResponse } from "next/server";
import { getLeads, getLead, createLead, appendTimeline, type Lead } from "@/lib/leads";
import { notifyTelegram, notifyArnoldWebhook } from "@/lib/arnold";
import { autoFolder } from "@/lib/folders";
import { jsonError } from "@/lib/api";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * BLP webchat (public/widget.js on brighamlarsonpianos.com) → General Inbox.
 * Public endpoint — the widget posts {name, phone, message, page} from the
 * website, so it's CORS-gated to BLP domains plus a honeypot for bots.
 * Conversation continues over SMS from the Sales Console.
 */

const ORIGIN_OK = /^https:\/\/(www\.)?brighamlarsonpianos\.(com|org|tech)$/;
const ORIGIN_DEV = /^http:\/\/localhost(:\d+)?$/;

function corsHeaders(req: NextRequest): Record<string, string> {
  const origin = req.headers.get("origin") || "";
  const allowed = ORIGIN_OK.test(origin) || ORIGIN_DEV.test(origin) ? origin : "https://brighamlarsonpianos.com";
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req) });
}

export async function POST(req: NextRequest) {
  const headers = corsHeaders(req);
  try {
    const input = (await req.json()) as {
      name?: string;
      phone?: string;
      message?: string;
      page?: string;
      pageTitle?: string;
      website?: string; // honeypot — humans never see this field
    };
    // Bots fill the invisible field; pretend success and drop it.
    if ((input.website || "").trim()) return NextResponse.json({ ok: true }, { headers });

    const name = (input.name || "").trim().slice(0, 80);
    const message = (input.message || "").trim().slice(0, 1200);
    const digits = (input.phone || "").replace(/\D/g, "").slice(-10);
    if (!name || !message || digits.length !== 10) {
      return NextResponse.json({ error: "name, 10-digit phone, and message are required" }, { status: 400, headers });
    }
    // Page context: the killer feature — what were they looking at?
    let page = "";
    try {
      const u = new URL(input.page || "");
      page = u.pathname + u.search;
    } catch {
      page = (input.page || "").slice(0, 200);
    }

    const { leads, shape } = await getLeads(true);
    const matches = leads.filter((l) => l.phoneDialable.endsWith(digits));
    let lead: Lead | undefined =
      matches.find((l) => l.statusBucket === "new" || l.statusBucket === "active") ||
      matches.sort((a, b) => (b.lastTouchISO || "").localeCompare(a.lastTouchISO || ""))[0];
    let leadShape = shape;
    let created = false;

    if (!lead) {
      const parts = name.split(/\s+/).filter(Boolean);
      const id = await createLead({
        firstName: parts[0] || "Webchat visitor",
        lastName: parts.slice(1).join(" "),
        phone: `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`,
        headline: message.slice(0, 90),
        source: "Website chat",
        inquiryMethod: "Webchat",
        status: "Support",
        capturedBy: "app",
      });
      const found = await getLead(id);
      if (!found) throw new Error("Lead vanished right after creation");
      lead = found.lead;
      leadShape = found.shape;
      created = true;
    }

    const looksService =
      /\b(tun(e|ing)|reschedul|re-?schedule|appointment|move(r|d|ing)?|moving|pick ?up|deliver|invoice|receipt|warrant|repair visit)\b/i.test(
        message
      );
    const detail =
      `🌐 Webchat message from ${name}: "${message}"` + (page ? `\n📄 They were on: ${page}` : "");

    await appendTimeline(
      lead,
      leadShape,
      {
        at: new Date().toISOString(),
        who: lead.name || name,
        kind: "inbound",
        source: "webchat",
        folder: autoFolder(lead.leadType, lead.headline, message),
        text: detail,
      },
      { touchLastContact: !created && !looksService }
    );

    notifyTelegram(
      `🌐 <b>Webchat from ${name}</b>${created ? " (new contact — filed to the General Inbox)" : ` (matched to ${lead.name})`}` +
        `${page ? `\n📄 Page: ${page}` : ""}\n"${message.slice(0, 300)}"`
    ).catch(() => {});
    if (!created && !looksService) {
      notifyArnoldWebhook({
        event: "inbound_reply",
        lead: { id: lead.id },
        note: `${lead.name} messaged via the website chat (page: ${page || "unknown"}): "${message.slice(0, 400)}". Refresh pending drafts to respond.`,
      }).catch(() => {});
    }

    return NextResponse.json({ ok: true }, { headers });
  } catch (err) {
    const res = jsonError(err);
    // Re-issue with CORS so the widget can read the failure.
    return new NextResponse(res.body, { status: res.status, headers: { ...headers, "Content-Type": "application/json" } });
  }
}
