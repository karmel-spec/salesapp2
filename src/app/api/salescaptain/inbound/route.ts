import { NextRequest, NextResponse } from "next/server";
import { getLeads, appendTimeline, type Lead } from "@/lib/leads";
import { notifyTelegram, notifyArnoldWebhook } from "@/lib/arnold";
import { isValidArnoldKey } from "@/lib/auth";
import { jsonError } from "@/lib/api";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * SalesCaptain text/webchat notifications → lead timelines.
 *
 * SalesCaptain emails karmel@ a "You got a new incoming message!" alert from
 * no-reply@salescaptain.com for each inbound text/webchat. The email watcher
 * recognizes those and POSTs the parsed fields here. We match the sender to a
 * lead (name → phone), log an inbound event (making it OUR TURN), ping the
 * team, and wake Arnold. No SalesCaptain API needed.
 */
export async function POST(req: NextRequest) {
  if (!isValidArnoldKey(req.headers.get("x-blp-key"))) {
    return NextResponse.json({ error: "Invalid or missing x-blp-key" }, { status: 401 });
  }
  try {
    const input = (await req.json()) as {
      senderName?: string;
      senderPhone?: string;
      messageText?: string;
      at?: string;
    };
    const name = (input.senderName || "").trim();
    const phone = (input.senderPhone || "").replace(/\D/g, "").slice(-10);
    if (!name && !phone) {
      return NextResponse.json({ error: "senderName or senderPhone required" }, { status: 400 });
    }

    const { leads, shape } = await getLeads(true);
    let lead: Lead | undefined;
    let how = "";

    if (phone.length === 10) {
      lead = leads.find((l) => l.phoneDialable.endsWith(phone));
      if (lead) how = "phone match";
    }
    if (!lead && name) {
      const n = name.toLowerCase();
      // Full-name contains match, then fall back to exact first+last.
      lead =
        leads.find((l) => l.name.toLowerCase() === n) ||
        leads.find((l) => l.name && n.includes(l.name.toLowerCase())) ||
        leads.find((l) => l.firstName && l.lastName && n === `${l.firstName} ${l.lastName}`.toLowerCase());
      if (lead) how = "name match";
    }

    const body = (input.messageText || "").trim();
    const detail = body
      ? `📥 SalesCaptain message from ${name || phone}: "${body.slice(0, 500)}"`
      : `📥 SalesCaptain message from ${name || phone} — they're waiting for a reply (full text in SalesCaptain).`;

    if (!lead) {
      notifyTelegram(
        `📥 <b>SalesCaptain message — no matching lead</b> (${name || phone})` +
          `${body ? `:\n"${body.slice(0, 300)}"` : " — waiting for a reply."}\n` +
          `→ If this is a lead, open them and log it, or add them as a new lead.`
      ).catch(() => {});
      return NextResponse.json({ matched: false });
    }

    await appendTimeline(
      lead,
      shape,
      { at: input.at || new Date().toISOString(), who: lead.name, kind: "inbound", text: detail },
      { touchLastContact: true }
    );
    notifyTelegram(
      `📥 <b>${lead.name} messaged via SalesCaptain</b> (${how}) — it's our turn.` +
        `${body ? `\n"${body.slice(0, 300)}"` : ""}`
    ).catch(() => {});
    notifyArnoldWebhook({
      event: "inbound_reply",
      lead: { id: lead.id },
      note: `${lead.name} sent an inbound message via SalesCaptain${body ? `: "${body.slice(0, 400)}"` : " (text not captured; they're waiting)"}. Refresh pending drafts to respond.`,
    }).catch(() => {});

    return NextResponse.json({ matched: true, leadId: lead.id, leadName: lead.name, how });
  } catch (err) {
    return jsonError(err);
  }
}
