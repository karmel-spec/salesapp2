import { NextRequest, NextResponse } from "next/server";
import { getLead, appendTimeline } from "@/lib/leads";
import { sendSms, sendEmail } from "@/lib/comms";
import { requireSession, jsonError } from "@/lib/api";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Direct human send from the lead page (no Arnold draft involved).
 * Body: { channel: "sms" | "email", body, subject?, who? }
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
      channel: "sms" | "email";
      body?: string;
      subject?: string;
      who?: string;
    };
    const body = (input.body || "").trim();
    const subject = (input.subject || "").trim();
    const who = input.who || "app";
    if (!body) return NextResponse.json({ error: "Message body is empty" }, { status: 400 });

    let deliveryNote: string;
    if (input.channel === "sms") {
      if (!lead.phoneDialable) {
        return NextResponse.json({ error: `No dialable phone number on this lead ("${lead.phone}")` }, { status: 400 });
      }
      const { sid } = await sendSms(lead.phoneDialable, body);
      deliveryNote = `SMS sent to ${lead.phoneDialable} (Twilio ${sid})`;
    } else if (input.channel === "email") {
      if (!lead.emailClean) {
        return NextResponse.json({ error: `No valid email on this lead ("${lead.email}")` }, { status: 400 });
      }
      if (!subject) return NextResponse.json({ error: "Email subject is required" }, { status: 400 });
      const { messageId } = await sendEmail(lead.emailClean, subject, body);
      deliveryNote = `Email "${subject}" sent to ${lead.emailClean} (${messageId})`;
    } else {
      return NextResponse.json({ error: `Unknown channel "${input.channel}"` }, { status: 400 });
    }

    const now = new Date().toISOString();
    await appendTimeline(
      lead,
      shape,
      {
        at: now,
        who,
        kind: input.channel === "sms" ? "sms_out" : "email_out",
        text:
          input.channel === "email"
            ? `${deliveryNote} — written by ${who}. Full message:\nSubject: ${subject}\n\n${body}`
            : `${deliveryNote} — written by ${who}. Full message:\n${body}`,
      },
      { touchLastContact: true }
    );
    return NextResponse.json({ ok: true, detail: deliveryNote });
  } catch (err) {
    return jsonError(err);
  }
}
