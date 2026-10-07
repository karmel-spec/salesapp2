import { NextRequest, NextResponse } from "next/server";
import { getLead } from "@/lib/leads";
import { requireSession, jsonError } from "@/lib/api";
import { type Handoff, saveDraft, deleteDraft, handoffStoreReady } from "@/lib/won";

export const dynamic = "force-dynamic";

/** Autosave of the WON wizard (every change, debounced client-side). One draft per lead; survives devices and browsers. */
export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = requireSession(req);
  if (guard) return guard;
  try {
    const { id } = await ctx.params;
    if (!handoffStoreReady()) return NextResponse.json({ ok: false, reason: "store not configured" });
    const body = (await req.json()) as { handoff?: Handoff; step?: number; who?: string };
    if (!body.handoff) return NextResponse.json({ error: "handoff required" }, { status: 400 });
    const found = await getLead(id);
    if (!found) return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    await saveDraft(id, found.lead.name, body.handoff, Number(body.step) || 0, (body.who || "app").slice(0, 40));
    return NextResponse.json({ ok: true, at: new Date().toISOString() });
  } catch (err) {
    return jsonError(err);
  }
}

/** Discard the draft (Start over, or the lead was marked Won without a handoff). */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = requireSession(req);
  if (guard) return guard;
  try {
    const { id } = await ctx.params;
    if (handoffStoreReady()) await deleteDraft(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return jsonError(err);
  }
}
