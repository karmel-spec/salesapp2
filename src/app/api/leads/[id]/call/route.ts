import { NextRequest, NextResponse } from "next/server";
import { getLead, appendTimeline } from "@/lib/leads";
import { startBridgeCall } from "@/lib/comms";
import { requireSession, jsonError } from "@/lib/api";
import { toE164 } from "@/lib/twilio-voice";
import { config } from "@/lib/config";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Click-to-call (cell-phone mode): bridge the rep and the customer. Rep's
 * phone rings first (displaying the store number); answering dials the
 * customer, who sees the store's public caller ID. The browser dialer
 * (/api/twilio/token + /api/twilio/outbound) is the no-phone alternative.
 *
 * Body: { repPhone: string, who?: string, to?: string }
 *   to — any number (Brigham 11/4: a spouse's, an assistant's…); defaults
 *        to the lead's primary number.
 *
 * Logged as a `call_attempt` (does NOT touch the stale clock) — the
 * recording pipeline files the real `call` with transcript + summary.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = requireSession(req);
  if (guard) return guard;
  try {
    const { id } = await ctx.params;
    const found = await getLead(id);
    if (!found) return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    const { lead, shape } = found;

    const body = (await req.json()) as { repPhone?: string; who?: string; to?: string };
    const to = body.to ? toE164(body.to) : lead.phoneDialable;
    if (body.to && !to) return NextResponse.json({ error: `"${body.to}" isn't a 10-digit phone number` }, { status: 400 });
    if (!to) {
      return NextResponse.json({ error: `No dialable phone number on this lead ("${lead.phone}") — type one to call` }, { status: 400 });
    }
    const repPhone = toE164(body.repPhone || "");
    if (!repPhone) return NextResponse.json({ error: "Enter your 10-digit phone number — it rings first" }, { status: 400 });

    const { sid } = await startBridgeCall(repPhone, to, { leadId: lead.id });
    const known = lead.phones.find((p) => p.dialable === to);
    const target = known ? `${known.label ? `${known.label} ` : ""}${known.number}` : to;
    await appendTimeline(lead, shape, {
      at: new Date().toISOString(),
      who: body.who || "app",
      kind: "call_attempt",
      text: `Bridge call started: rep ${repPhone} → ${target}, caller ID ${config.twilioCallerId} (Twilio ${sid}). Recording + transcript file here when the call ends.`,
    });
    return NextResponse.json({
      ok: true,
      detail: `Your phone (${repPhone}) is ringing now — answer it and we'll dial ${target}. They'll see ${config.twilioCallerId}.`,
    });
  } catch (err) {
    return jsonError(err);
  }
}
