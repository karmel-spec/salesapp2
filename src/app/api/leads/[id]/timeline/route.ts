import { NextRequest, NextResponse } from "next/server";
import { getLead, appendTimeline, updateTimelineEvent } from "@/lib/leads";
import { requireSession, jsonError } from "@/lib/api";

export const dynamic = "force-dynamic";

/** Log an activity (note, call, etc.) on a lead's timeline. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = requireSession(req);
  if (guard) return guard;
  try {
    const { id } = await ctx.params;
    const found = await getLead(id);
    if (!found) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

    const body = (await req.json()) as {
      kind?: string;
      text?: string;
      who?: string;
      touchLastContact?: boolean;
    };
    if (!body.text?.trim()) return NextResponse.json({ error: "text is required" }, { status: 400 });

    await appendTimeline(
      found.lead,
      found.shape,
      {
        at: new Date().toISOString(),
        who: body.who || "app",
        kind: body.kind || "note",
        text: body.text.trim(),
      },
      { touchLastContact: body.touchLastContact ?? ["call", "sms_out", "email_out"].includes(body.kind || "") }
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    return jsonError(err);
  }
}

/** Edit a past activity entry. Body: { index, text, who? } */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = requireSession(req);
  if (guard) return guard;
  try {
    const { id } = await ctx.params;
    const found = await getLead(id, true);
    if (!found) return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    const body = (await req.json()) as { index?: number; text?: string; who?: string };
    if (typeof body.index !== "number" || !body.text?.trim()) {
      return NextResponse.json({ error: "index and text are required" }, { status: 400 });
    }
    const ev = await updateTimelineEvent(found.lead, found.shape, body.index, body.text, body.who || "app");
    return NextResponse.json({ ok: true, event: ev });
  } catch (err) {
    return jsonError(err);
  }
}
