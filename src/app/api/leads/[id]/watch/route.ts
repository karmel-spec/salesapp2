import { NextRequest, NextResponse } from "next/server";
import { getLead } from "@/lib/leads";
import { previewWatch, setWatch, clearWatch } from "@/lib/watch";
import { describe } from "@/lib/pianolog";
import { requireSession, jsonError } from "@/lib/api";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** POST { text, serial?, mode, who, preview?, baseline? } — snooze until the Piano Log shows it.
 *  preview:true only returns what's in stock right now. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = requireSession(req);
  if (guard) return guard;
  try {
    const { id } = await ctx.params;
    const found = await getLead(id, true);
    if (!found) return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    const body = (await req.json()) as { text?: string; serial?: string; mode?: "arrival" | "finished"; who?: string; preview?: boolean; baseline?: boolean };
    const mode = body.mode === "finished" ? "finished" : "arrival";
    const text = (body.text || "").trim();
    const serial = (body.serial || "").trim();
    if (mode === "finished" && !serial) return NextResponse.json({ error: "A serial number is needed to watch for a specific piano to be finished" }, { status: 400 });
    if (mode === "arrival" && text.length < 3) return NextResponse.json({ error: "Describe what they're waiting for (e.g. \"Acrosonic spinet\")" }, { status: 400 });
    if (body.preview) {
      const { matches, serialPiano } = await previewWatch({ text, serial, mode });
      return NextResponse.json({ preview: true, count: matches.length, matches: matches.slice(0, 12).map(describe), serialFound: !!serialPiano, serialSold: serialPiano?.sold || false, serialFinished: serialPiano?.finished || false });
    }
    const r = await setWatch(found.lead, found.shape, { text: text || (serial ? `#${serial}` : ""), serial, mode, who: body.who || "app", baseline: body.baseline !== false });
    return NextResponse.json({ ok: true, status: `Snoozed until 🎹 …`, watch: r.watch, inStockNow: r.matches.slice(0, 12).map(describe) });
  } catch (err) {
    return jsonError(err);
  }
}

/** DELETE — clear the watch and make the lead active. */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = requireSession(req);
  if (guard) return guard;
  try {
    const { id } = await ctx.params;
    const found = await getLead(id, true);
    if (!found) return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    await clearWatch(found.lead, found.shape, req.nextUrl.searchParams.get("who") || "app");
    return NextResponse.json({ ok: true });
  } catch (err) {
    return jsonError(err);
  }
}
