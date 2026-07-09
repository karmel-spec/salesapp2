import { NextRequest, NextResponse } from "next/server";
import { getLead, saveDrafts, appendTimeline, type DraftMessage } from "@/lib/leads";
import { sendSms, sendEmail } from "@/lib/comms";
import { notifyArnoldWebhook } from "@/lib/arnold";
import { requireSession, jsonError } from "@/lib/api";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Act on an Arnold draft: human approves (and it sends), dismisses, or
 * coaches ("train": feedback goes to the lead timeline + Arnold's brain,
 * which records the lesson and rewrites the draft).
 * Body: {
 *   createdAt, channel,          // identifies the draft
 *   action: "approve_send" | "dismiss" | "train",
 *   body?, subject?,             // human edits before sending
 *   feedback?,                   // for "train"
 *   who?: string
 * }
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = requireSession(req);
  if (guard) return guard;
  try {
    const { id } = await ctx.params;
    const found = await getLead(id);
    if (!found) return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    const { lead, shape } = found;

    const input = (await req.json()) as {
      createdAt: string;
      channel: "sms" | "email";
      action: "approve_send" | "dismiss" | "train";
      body?: string;
      subject?: string;
      feedback?: string;
      who?: string;
    };
    const idx = lead.drafts.findIndex(
      (d) => d.createdAt === input.createdAt && d.channel === input.channel && d.status === "pending"
    );
    if (idx < 0) return NextResponse.json({ error: "Pending draft not found" }, { status: 404 });

    const drafts: DraftMessage[] = [...lead.drafts];
    const draft = { ...drafts[idx] };
    const who = input.who || "app";
    const now = new Date().toISOString();

    if (input.action === "train") {
      const feedback = (input.feedback || "").trim();
      if (!feedback) return NextResponse.json({ error: "Coaching feedback is empty" }, { status: 400 });
      await appendTimeline(lead, shape, {
        at: now,
        who,
        kind: "coaching",
        text: `🎓 Coaching for Arnold on his ${draft.channel} draft: ${feedback}\n(draft being coached: "${draft.body.slice(0, 160)}${draft.body.length > 160 ? "…" : ""}")`,
      });
      const ping = await notifyArnoldWebhook({
        event: "training_feedback",
        lead: { id: lead.id },
        note:
          `${who} coached your pending ${draft.channel} draft for ${lead.name}. Feedback: "${feedback}". ` +
          `Record the lesson in kb/coaching-feedback.md (dated, generalized so it improves ALL future drafts), ` +
          `then rewrite this lead's pending draft(s) applying it.`,
      }).catch(() => ({ ok: false, detail: "webhook unreachable" }));
      return NextResponse.json({
        ok: true,
        status: "coached",
        detail: ping.ok
          ? "Coaching sent — Arnold is recording the lesson and rewriting the draft."
          : "Coaching saved to the lead's activity — Arnold picks it up on his next drafting pass (his brain wasn't reachable right now).",
      });
    }

    if (input.action === "dismiss") {
      draft.status = "dismissed";
      drafts[idx] = draft;
      await saveDrafts(lead, shape, drafts);
      return NextResponse.json({ ok: true, status: "dismissed" });
    }

    // approve_send — apply human edits, then send for real.
    const finalBody = (input.body ?? draft.body).trim();
    const finalSubject = (input.subject ?? draft.subject ?? "").trim();
    if (!finalBody) return NextResponse.json({ error: "Message body is empty" }, { status: 400 });

    let deliveryNote: string;
    if (draft.channel === "sms") {
      if (!lead.phoneDialable) {
        return NextResponse.json({ error: `No dialable phone number on this lead ("${lead.phone}")` }, { status: 400 });
      }
      const { sid } = await sendSms(lead.phoneDialable, finalBody);
      deliveryNote = `SMS sent to ${lead.phoneDialable} (Twilio ${sid})`;
    } else {
      if (!lead.emailClean) {
        return NextResponse.json({ error: `No valid email on this lead ("${lead.email}")` }, { status: 400 });
      }
      if (!finalSubject) return NextResponse.json({ error: "Email subject is required" }, { status: 400 });
      const { messageId } = await sendEmail(lead.emailClean, finalSubject, finalBody);
      deliveryNote = `Email "${finalSubject}" sent to ${lead.emailClean} (${messageId})`;
    }

    draft.status = "sent";
    draft.sentAt = now;
    draft.body = finalBody;
    if (draft.channel === "email") draft.subject = finalSubject;
    drafts[idx] = draft;
    await saveDrafts(lead, shape, drafts);
    await appendTimeline(
      lead,
      shape,
      {
        at: now,
        who,
        kind: draft.channel === "sms" ? "sms_out" : "email_out",
        text:
          draft.channel === "email"
            ? `${deliveryNote} — approved Arnold draft. Full message:\nSubject: ${finalSubject}\n\n${finalBody}`
            : `${deliveryNote} — approved Arnold draft. Full message:\n${finalBody}`,
      },
      { touchLastContact: true }
    );
    return NextResponse.json({ ok: true, status: "sent", detail: deliveryNote });
  } catch (err) {
    return jsonError(err);
  }
}
