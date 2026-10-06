import { NextRequest, NextResponse } from "next/server";
import { listDaysOff, addDayOff, removeDayOff } from "@/lib/days-off";
import { requireSession, jsonError } from "@/lib/api";

export const dynamic = "force-dynamic";

/** Days off that never break a streak. GET list · POST {from,to,who,note,addedBy} · DELETE ?from=&who= */
export async function GET(req: NextRequest) {
  const guard = requireSession(req); if (guard) return guard;
  try { return NextResponse.json({ items: await listDaysOff() }); } catch (err) { return jsonError(err); }
}
export async function POST(req: NextRequest) {
  const guard = requireSession(req); if (guard) return guard;
  try {
    const b = (await req.json()) as { from?: string; to?: string; who?: string; note?: string; addedBy?: string };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(b.from || "")) return NextResponse.json({ error: "from must be YYYY-MM-DD" }, { status: 400 });
    await addDayOff({ from: b.from!, to: /^\d{4}-\d{2}-\d{2}$/.test(b.to || "") ? b.to! : b.from!, who: (b.who || "Brigham").trim(), note: (b.note || "").trim().slice(0, 120), addedBy: (b.addedBy || "app").trim() });
    return NextResponse.json({ ok: true });
  } catch (err) { return jsonError(err); }
}
export async function DELETE(req: NextRequest) {
  const guard = requireSession(req); if (guard) return guard;
  try {
    await removeDayOff(req.nextUrl.searchParams.get("from") || "", req.nextUrl.searchParams.get("who") || "Brigham");
    return NextResponse.json({ ok: true });
  } catch (err) { return jsonError(err); }
}
