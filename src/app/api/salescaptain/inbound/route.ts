import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getLeads, getLead, createLead, appendTimeline, updateLeadFields, updateTimelineEvent, markInboundRead, type Lead } from "@/lib/leads";
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
      sourceMessageId?: string; // RFC Message-ID of the alert email (identical in every mailbox it reached)
      account?: string; // which mailbox the alert was read from (debugging only)
      photo?: boolean; // the alert says a photo/MMS was sent but carries no image
      backfill?: boolean; // historical import: log it, but no Telegram/Arnold and no last-contact bump
      // --- SalesCaptain REST sync fields ---
      direction?: "inbound" | "outbound"; // outbound = a BLP rep (or the auto-reply) sent it from SalesCaptain
      who?: string; // outbound sender's first name
      media?: string[]; // attachment URLs (photos, MMS)
      senderEmail?: string;
      salesCaptainMessageId?: string; // dedupe key when the message came via the API
      salesCaptainContactId?: string;
      salesCaptainConversationId?: string;
      noCreate?: boolean; // replay mode: never create a new contact
    };
    const quiet = input.backfill === true;
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
      // Name matching only when the phone can't decide: two different
      // "Carlos"es with two different numbers were merged into one lead this
      // way. A candidate must have no phone on file, or the same phone.
      const phoneOk = (l: Lead) => !phone || !l.phoneDialable || l.phoneDialable.endsWith(phone);
      const candidates = leads.filter(phoneOk);
      lead =
        candidates.find((l) => l.name.toLowerCase() === n) ||
        candidates.find((l) => l.name && l.name.includes(" ") && n.includes(l.name.toLowerCase())) ||
        candidates.find((l) => l.firstName && l.lastName && n === `${l.firstName} ${l.lastName}`.toLowerCase());
      if (lead) how = "name match";
    }

    const body = (input.messageText || "").trim();
    // One alert can land in karmel@, brigham@, melissa@ and info@ at once, and the
    // Mac watcher may see it too. The RFC Message-ID is identical in every copy,
    // so it's the dedupe key; without one, hash the content.
    const fingerprint = input.salesCaptainMessageId
      ? `salescaptain:msg:${input.salesCaptainMessageId.trim()}`
      : input.sourceMessageId
        ? `salescaptain:${input.sourceMessageId.trim()}`
        : `salescaptain:${crypto.createHash("sha1").update(`${input.at || ""}|${name}|${phone}|${body}`).digest("hex")}`;
    if (lead && lead.timeline.some((e) => e.fingerprint === fingerprint)) {
      return NextResponse.json({ matched: true, duplicate: true, leadId: lead.id, leadName: lead.name, how });
    }
    const direction = input.direction === "outbound" ? "outbound" : "inbound";
    const media = (Array.isArray(input.media) ? input.media : []).filter((u) => typeof u === "string" && /^https?:\/\//.test(u)).slice(0, 10);
    const mediaLines = media.length ? `\n📎 ${media.join("\n📎 ")}` : "";
    const at = input.at || new Date().toISOString();
    const atMs = Date.parse(at) || Date.now();
    const norm = (x: string) => x.replace(/\s+/g, " ").trim().toLowerCase();

    // Cross-path dedupe: the same customer text may already be on the timeline
    // from an email alert (different fingerprint). Same lead, within 3 minutes,
    // same words → duplicate. A real photo link upgrades an email-alert
    // "a photo was sent" placeholder instead of adding a second event.
    if (lead && direction === "inbound") {
      const near = lead.timeline.filter((e) => e.kind === "inbound" && Math.abs(Date.parse(e.at) - atMs) <= 3 * 60_000);
      const key = norm(body).slice(0, 60);
      const twin = key.length >= 3 ? near.find((e) => norm(e.text || "").includes(key)) : undefined;
      if (twin) return NextResponse.json({ matched: true, duplicate: true, contentMatch: true, leadId: lead.id, leadName: lead.name, how });
      if (media.length) {
        const ph = near.find((e) => /photo was sent/i.test(e.text || ""));
        if (ph) {
          await updateTimelineEvent(lead, shape, lead.timeline.indexOf(ph), `📥 SalesCaptain message from ${lead.name}: 📷 photo${body ? ` "${body.slice(0, 200)}"` : ""}${mediaLines}`, "SalesCaptain sync");
          return NextResponse.json({ matched: true, duplicate: true, upgradedPhoto: true, leadId: lead.id, leadName: lead.name, how });
        }
      }
    }

    // The API knows the phone even when the alert email didn't: fill it in.
    if (lead && !lead.phoneDialable && phone.length === 10) {
      try {
        await updateLeadFields(lead, shape, { phone: `(${phone.slice(0, 3)}) ${phone.slice(3, 6)}-${phone.slice(6)}` });
        how += " · phone added";
      } catch {}
    }

    // Outbound: a rep answered from SalesCaptain. Log it as outreach and mark
    // the customer's earlier unread messages read — the reply already happened.
    if (direction === "outbound") {
      if (!lead) return NextResponse.json({ matched: false, skipped: "outbound to a contact not in the Leads Log" });
      const who = (input.who || "SalesCaptain").trim();
      const isRep = !/salescaptain|captain ai|auto-reply/i.test(who);
      const isCall = input.channel === "call";
      const kind = input.channel === "email" ? "email_out" : isCall ? "call_attempt" : "sms_out";
      const via = input.channel && input.channel !== "text" && !isCall ? ` (${input.channel})` : "";
      const text = isCall
        ? `${body || "📞 Outgoing call"} — via SalesCaptain by ${who}`
        : `${kind === "email_out" ? "📧" : "💬"} ${who} replied via SalesCaptain${via}: "${body.slice(0, 4000)}"${mediaLines}`;
      await appendTimeline(lead, shape, { at, who, kind, source: input.channel || "salescaptain", text, fingerprint }, { touchLastContact: isRep && !quiet });
      let markedRead = 0;
      if (isRep) {
        const ats = lead.timeline.filter((e) => e.kind === "inbound" && !e.readAt && Date.parse(e.at) <= atMs).map((e) => e.at);
        if (ats.length) markedRead = await markInboundRead(lead, shape, ats, who).catch(() => 0);
      }
      return NextResponse.json({ matched: true, outbound: true, leadId: lead.id, leadName: lead.name, how, markedRead });
    }
    if (!lead && input.noCreate) return NextResponse.json({ matched: false, skipped: "unknown contact (noCreate)" });
    // Service signals (tuning, moves, scheduling) — customer-service traffic,
    // not sales. Don't wake Arnold for these even on a matched lead.
    const looksService = /\b(tun(e|ing)|reschedul|re-?schedule|appointment|move(r|d|ing)?|moving|pick ?up|deliver|invoice|receipt|warrant|repair visit)\b/i.test(body);
    // Photo alerts carry only a marker ("🏞️ Photo"), never the image. Say
    // exactly that — never that BLP received or reviewed a photo.
    const detail = media.length
      ? `📥 SalesCaptain message from ${name || phone}: 📷 photo${body ? ` "${body.slice(0, 4000)}"` : ""}${mediaLines}`
      : input.photo
      ? `📥 SalesCaptain message from ${name || phone}: 📷 a photo was sent (SalesCaptain notification marker${body ? ` "${body.slice(0, 200)}"` : ""}; the image isn't available in the Sales App — view it in SalesCaptain).`
      : body
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
          email: input.senderEmail || "",
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
            fingerprint,
          });
        }
        if (!quiet)
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
        fingerprint,
      },
      { touchLastContact: !looksService && !quiet }
    );
    if (quiet) return NextResponse.json({ matched: true, backfill: true, service: looksService, leadId: lead.id, leadName: lead.name, how });

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
