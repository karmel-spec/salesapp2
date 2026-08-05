import { NextRequest, NextResponse } from "next/server";
import { getLeads, getLead, createLead, appendTimeline, type Lead } from "@/lib/leads";
import { notifyTelegram, notifyArnoldWebhook } from "@/lib/arnold";
import { isValidArnoldKey } from "@/lib/auth";
import { jsonError } from "@/lib/api";
import { autoFolder } from "@/lib/folders";

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
      channel?: string; // "text" | "webchat" | "facebook" | "instagram" when the alert says
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
    // Service signals (tuning, moves, scheduling) — customer-service traffic,
    // not sales. Don't wake Arnold for these even on a matched lead.
    const looksService = /\b(tun(e|ing)|reschedul|re-?schedule|appointment|move(r|d|ing)?|moving|pick ?up|deliver|invoice|receipt|warrant|repair visit)\b/i.test(body);
    const detail = body
      ? `📥 SalesCaptain message from ${name || phone}: "${body.slice(0, 4000)}"`
      : `📥 SalesCaptain message from ${name || phone} — they're waiting for a reply (full text in SalesCaptain).`;

    if (!lead) {
      // Not in the Leads Log yet — auto-create a Support contact so the
      // message still lands in the General Inbox (the main-line "forward":
      // nothing is lost during the SalesCaptain transition).
      try {
        const parts = name.split(/\s+/).filter(Boolean);
        const prettyPhone =
          phone.length === 10 ? `(${phone.slice(0, 3)}) ${phone.slice(3, 6)}-${phone.slice(6)}` : phone;
        const id = await createLead({
          firstName: parts[0] || prettyPhone || "Unknown caller",
          lastName: parts.slice(1).join(" "),
          phone: input.senderPhone || "",
          headline: body.slice(0, 90) || "Messaged the main BLP line",
          source: "Main line (SalesCaptain)",
          inquiryMethod: "Text",
          status: "Support",
          capturedBy: "app",
        });
        const created = await getLead(id);
        if (created) {
          await appendTimeline(created.lead, created.shape, {
            at: input.at || new Date().toISOString(),
            who: name || prettyPhone || "customer",
            kind: "inbound",
            source: input.channel || "salescaptain",
            folder: autoFolder("", "", body),
            text: detail,
          });
        }
        notifyTelegram(
          `💬 <b>New contact on the main line</b> — ${name || prettyPhone} filed to the General Inbox.` +
            `${body ? `\n"${body.slice(0, 300)}"` : ""}`
        ).catch(() => {});
        return NextResponse.json({ matched: false, created: true, leadId: id });
      } catch {
        // Duplicate guard or a sheet hiccup — fall back to the old quiet FYI.
        notifyTelegram(
          `💬 <b>SalesCaptain message</b> (couldn't auto-file) — ${name || phone}` +
            `${body ? `:\n"${body.slice(0, 300)}"` : " — reply waiting in SalesCaptain."}`
        ).catch(() => {});
        return NextResponse.json({ matched: false, service: true });
      }
    }

    // A matched lead writing about tuning/moves is a service touch, not a
    // sales reply: log it (so the history is complete) but tag it and don't
    // reset the sales-quiet clock or wake Arnold to draft.
    await appendTimeline(
      lead,
      shape,
      {
        at: input.at || new Date().toISOString(),
        who: lead.name,
        kind: "inbound",
        source: input.channel || "salescaptain",
        folder: autoFolder(lead.leadType, lead.headline, `${detail}`),
        text: looksService ? `${detail} [service — tuning/move, not a sales reply]` : detail,
      },
      { touchLastContact: !looksService }
    );

    if (looksService) {
      notifyTelegram(
        `💬 <b>${lead.name} (a sales lead) messaged about service</b> via SalesCaptain — handle as customer service, not a sales follow-up.` +
          `${body ? `\n"${body.slice(0, 300)}"` : ""}`
      ).catch(() => {});
      return NextResponse.json({ matched: true, service: true, leadId: lead.id, leadName: lead.name, how });
    }

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
