import { NextRequest, NextResponse } from "next/server";
import { getLead, appendTimeline } from "@/lib/leads";
import { listUnfiled, resolveUnfiled } from "@/lib/plaud-unfiled";
import { requireSession, jsonError } from "@/lib/api";
import { notifyArnoldWebhook } from "@/lib/arnold";

export const dynamic = "force-dynamic";

/** Open (unfiled) Plaud calls, newest first — the Dashboard card's data. */
export async function GET(req: NextRequest) {
  const guard = requireSession(req);
  if (guard) return guard;
  try {
    const items = (await listUnfiled())
      .filter((c) => c.status === "open")
      .sort((a, b) => (b.startedAt || b.receivedAt).localeCompare(a.startedAt || a.receivedAt));
    // The transcript excerpt stays server-side — the card only needs the summary.
    return NextResponse.json({ items: items.map(({ transcriptExcerpt: _t, ...rest }) => rest) });
  } catch (err) {
    return jsonError(err);
  }
}

/**
 * Resolve a queued call: { recordingId, action: "attach", leadId, who }
 * files it onto the lead's timeline; { action: "dismiss" } drops it
 * (recorded as dismissed, not deleted).
 */
export async function POST(req: NextRequest) {
  const guard = requireSession(req);
  if (guard) return guard;
  try {
    const body = await req.json();
    const who = (body.who || "team").toString();
    const recordingId = String(body.recordingId || "");
    if (!recordingId) return NextResponse.json({ error: "recordingId required" }, { status: 400 });

    if (body.action === "dismiss") {
      const item = await resolveUnfiled(recordingId, "dismissed", "", who);
      if (!item) return NextResponse.json({ error: "Recording not found or already handled" }, { status: 404 });
      return NextResponse.json({ ok: true });
    }

    const found = await getLead(String(body.leadId || ""));
    if (!found) return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    const item = await resolveUnfiled(recordingId, "filed", found.lead.id, who);
    if (!item) return NextResponse.json({ error: "Recording not found or already handled" }, { status: 404 });

    const mins = item.durationSec ? Math.round(item.durationSec / 60) : null;
    await appendTimeline(
      found.lead,
      found.shape,
      {
        at: item.startedAt || item.receivedAt,
        who: "Plaud",
        kind: "call",
        text:
          `📞 Call summary${mins ? ` (${mins} min)` : ""}${item.title ? ` — "${item.title}"` : ""}:\n` +
          `${item.summary.slice(0, 1500)}\n` +
          `(Plaud recording ${item.recordingId} — filed by ${who})`,
      },
      { touchLastContact: true }
    );
    notifyArnoldWebhook({
      event: "followup_instruction",
      lead: { id: found.lead.id },
      note:
        `A phone call with ${found.lead.name} was summarized (Plaud, filed by ${who}): ` +
        `"${item.summary.slice(0, 500)}". Update your pending drafts for this lead accordingly.`,
    }).catch(() => {});
    return NextResponse.json({ ok: true, leadId: found.lead.id, leadName: found.lead.name });
  } catch (err) {
    return jsonError(err);
  }
}
