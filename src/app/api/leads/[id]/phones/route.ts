import { NextRequest, NextResponse } from "next/server";
import { getLead, updateLeadFields, appendTimeline, parsePhones } from "@/lib/leads";
import { requireSession, jsonError } from "@/lib/api";
import { toE164 } from "@/lib/twilio-voice";

export const dynamic = "force-dynamic";

/**
 * Add a labeled number to a lead ("husband Rick 801-555-1234") — the Phone
 * column stays free text, so this appends ", <label> <number>" and the
 * parser picks it up everywhere (texts, calls, inbound matching).
 *
 * Body: { number: string, label?: string, who?: string }
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = requireSession(req);
  if (guard) return guard;
  try {
    const { id } = await ctx.params;
    const found = await getLead(id);
    if (!found) return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    const { lead, shape } = found;
    const body = (await req.json()) as { number?: string; label?: string; who?: string };
    const dialable = toE164(body.number || "");
    if (!dialable) return NextResponse.json({ error: "Enter a 10-digit phone number" }, { status: 400 });
    if (lead.phones.some((p) => p.dialable === dialable)) {
      return NextResponse.json({ ok: true, phones: lead.phones, detail: "That number is already on this lead." });
    }
    const label = (body.label || "").replace(/[,;\n]+/g, " ").trim();
    const pretty = `${dialable.slice(2, 5)}-${dialable.slice(5, 8)}-${dialable.slice(8)}`;
    const entry = `${label ? `${label} ` : ""}${pretty}`;
    const phone = lead.phone.trim() ? `${lead.phone.trim()}, ${entry}` : entry;
    await updateLeadFields(lead, shape, { phone }, { who: body.who || "Sales App" });
    await appendTimeline(lead, shape, {
      at: new Date().toISOString(),
      who: body.who || "app",
      kind: "edit",
      text: `Added phone number: ${entry}`,
    });
    return NextResponse.json({ ok: true, phones: parsePhones(phone), detail: `Saved ${entry} to ${lead.name}.` });
  } catch (err) {
    return jsonError(err);
  }
}
