import { NextRequest, NextResponse } from "next/server";
import { getLead, appendTimeline } from "@/lib/leads";
import { listScheduled, addScheduled, updateScheduled } from "@/lib/scheduled";
import { requireSession, jsonError } from "@/lib/api";

export const dynamic = "force-dynamic";

/** Pending/most-recent scheduled sends (?leadId= filters to one lead). */
export async function GET(req: NextRequest) {
  const guard = requireSession(req);
  if (guard) return guard;
  try {
    const leadId = req.nextUrl.searchParams.get("leadId") || undefined;
    const items = (await listScheduled(leadId)).sort((a, b) => a.sendAt.localeCompare(b.sendAt));
    return NextResponse.json({ items });
  } catch (err) {
    return jsonError(err);
  }
}

/**
 * Create a scheduled send: { leadId, channel, subject?, body, sendAt (ISO),
 * sendAs?, who } — or cancel one: { cancelId }.
 */
export async function POST(req: NextRequest) {
  const guard = requireSession(req);
  if (guard) return guard;
  try {
    const body = await req.json();

    if (body.cancelId) {
      const item = await updateScheduled(String(body.cancelId), { status: "canceled" });
      if (!item) return NextResponse.json({ error: "Scheduled send not found" }, { status: 404 });
      return NextResponse.json({ ok: true });
    }

    const found = await getLead(String(body.leadId || ""));
    if (!found) return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    const channel = body.channel === "email" ? "email" : "sms";
    const text = (body.body || "").trim();
    const sendAt = new Date(body.sendAt || "");
    if (!text) return NextResponse.json({ error: "Message body is empty" }, { status: 400 });
    if (isNaN(sendAt.getTime())) return NextResponse.json({ error: "Pick a valid date & time" }, { status: 400 });
    if (sendAt.getTime() < Date.now() - 60_000) {
      return NextResponse.json({ error: "That time is in the past — use Send now instead" }, { status: 400 });
    }
    if (channel === "email" && !(body.subject || "").trim()) {
      return NextResponse.json({ error: "Email subject is required" }, { status: 400 });
    }

    const who = body.who || "app";
    const item = await addScheduled({
      leadId: found.lead.id,
      leadName: found.lead.name,
      channel,
      subject: body.subject,
      body: text,
      sendAt: sendAt.toISOString(),
      sendAs: typeof body.sendAs === "string" ? body.sendAs : who,
      who,
    });
    // Team visibility: the schedule itself is an event.
    await appendTimeline(found.lead, found.shape, {
      at: new Date().toISOString(),
      who,
      kind: "note",
      text: `🕐 Scheduled a ${channel === "email" ? "email" : "text"} for ${sendAt.toLocaleString("en-US", {
        month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
      })}: "${text.slice(0, 120)}${text.length > 120 ? "…" : ""}" (id ${item.id})`,
    });
    return NextResponse.json({ ok: true, item });
  } catch (err) {
    return jsonError(err);
  }
}
