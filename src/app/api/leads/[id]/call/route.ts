import { NextRequest, NextResponse } from "next/server";
import { getLead, appendTimeline } from "@/lib/leads";
import { startBridgeCall } from "@/lib/comms";
import { requireSession, jsonError } from "@/lib/api";
import { config } from "@/lib/config";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Click-to-call: bridge the rep and the lead. Rep's phone rings first
 * (displaying the store number); answering dials the customer, who sees
 * the store's public caller ID.
 *
 * Body: { repPhone: string, who?: string }
 *
 * Logged as a `call_attempt` (does NOT touch the stale clock) — the rep
 * logs the outcome as a `call` from the activity form once they've talked.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = requireSession(req);
  if (guard) return guard;
  try {
    const { id } = await ctx.params;
    const found = await getLead(id);
    if (!found) return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    const { lead, shape } = found;
    if (!lead.phoneDialable) {
      return NextResponse.json({ error: `No dialable phone number on this lead ("${lead.phone}")` }, { status: 400 });
    }

    const body = (await req.json()) as { repPhone?: string; who?: string };
    const digits = (body.repPhone || "").replace(/\D+/g, "");
    const repPhone = digits.length === 10 ? `+1${digits}` : digits.length === 11 && digits.startsWith("1") ? `+${digits}` : "";
    if (!repPhone) return NextResponse.json({ error: "Enter your 10-digit phone number — it rings first" }, { status: 400 });

    const { sid } = await startBridgeCall(repPhone, lead.phoneDialable);
    await appendTimeline(lead, shape, {
      at: new Date().toISOString(),
      who: body.who || "app",
      kind: "call_attempt",
      text: `Bridge call started: rep ${repPhone} → ${lead.phoneDialable}, caller ID ${config.twilioCallerId} (Twilio ${sid}). Log the outcome once you've talked.`,
    });
    return NextResponse.json({
      ok: true,
      detail: `Your phone (${repPhone}) is ringing now — answer it and we'll dial ${lead.name}. They'll see ${config.twilioCallerId}.`,
    });
  } catch (err) {
    return jsonError(err);
  }
}
