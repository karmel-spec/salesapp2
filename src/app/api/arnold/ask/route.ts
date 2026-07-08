import { NextRequest, NextResponse } from "next/server";
import { getLead, saveDrafts, appendTimeline } from "@/lib/leads";
import { notifyArnoldWebhook, generateDraftsViaApi } from "@/lib/arnold";
import { requireSession, jsonError } from "@/lib/api";
import { config } from "@/lib/config";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * "Ask Arnold" — request AI draft suggestions for a lead.
 * Prefers Arnold's Hermes webhook (drafts arrive async via /api/arnold/draft);
 * falls back to direct Claude API generation in Arnold's voice.
 */
export async function POST(req: NextRequest) {
  const guard = requireSession(req);
  if (guard) return guard;
  try {
    const { leadId } = (await req.json()) as { leadId?: string };
    if (!leadId) return NextResponse.json({ error: "leadId required" }, { status: 400 });
    const found = await getLead(leadId);
    if (!found) return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    const { lead, shape } = found;

    if (config.arnoldWebhookUrl) {
      const ping = await notifyArnoldWebhook({
        event: "draft_request",
        lead: {
          id: lead.id,
          name: lead.name,
          headline: lead.headline,
          leadType: lead.leadType,
          pianoType: lead.pianoType,
          notes: lead.notes,
          activityTimeline: lead.activityTimeline,
          daysSinceContact: lead.daysSinceContact,
          effectiveRep: lead.effectiveRep,
        },
      });
      if (ping.ok) {
        return NextResponse.json({ mode: "webhook", detail: "Arnold is on it — drafts will appear shortly." });
      }
    }

    // Fallback: generate in-app via the Claude API.
    const { drafts, reasoning } = await generateDraftsViaApi(lead);
    const kept = lead.drafts.filter((d) => d.status !== "pending");
    await saveDrafts(lead, shape, [...kept, ...drafts]);
    await appendTimeline(lead, shape, {
      at: new Date().toISOString(),
      who: "Arnold",
      kind: "draft",
      text: `Arnold drafted SMS + email suggestions — ${reasoning}`,
    });
    return NextResponse.json({ mode: "api", detail: reasoning, drafts });
  } catch (err) {
    return jsonError(err);
  }
}
