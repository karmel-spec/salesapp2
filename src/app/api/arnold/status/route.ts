import { NextRequest, NextResponse } from "next/server";
import { getLeads } from "@/lib/leads";
import { config, integrationStatus } from "@/lib/config";
import { requireSession, jsonError } from "@/lib/api";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Live status for the Arnold console page. */
export async function GET(req: NextRequest) {
  const guard = requireSession(req);
  if (guard) return guard;
  try {
    // Is his brain reachable? Since 2026-10-08 that's the Agent Console's engine
    // status (Grok Bot relay or the in-app runner), not a tunnel to the Mac.
    let tunnelUp = false;
    let engine = "";
    try {
      const res = await fetch(`${config.agentsUrl}/api/agents/live`, {
        headers: { "x-blp-key": config.agentsKey },
        signal: AbortSignal.timeout(6000),
        cache: "no-store",
      });
      if (res.ok) {
        const j = (await res.json()) as { agents?: Record<string, { up?: boolean; engine?: string }> };
        tunnelUp = Boolean(j.agents?.arnold?.up);
        engine = j.agents?.arnold?.engine || "";
      }
    } catch {
      tunnelUp = false;
    }

    const { leads } = await getLeads();
    const today = new Date().toISOString().slice(0, 10);
    let pendingDrafts = 0;
    let sentToday = 0;
    let lastDraftAt: string | null = null;
    for (const l of leads) {
      for (const d of l.drafts) {
        if (d.status === "pending") pendingDrafts++;
        if (d.createdBy.startsWith("arnold")) {
          if (!lastDraftAt || d.createdAt > lastDraftAt) lastDraftAt = d.createdAt;
          if (d.status === "sent" && (d.sentAt || "").startsWith(today)) sentToday++;
        }
      }
    }
    const queue = leads.filter(
      (l) => (l.effectiveRep === "Arnold" || l.effectiveSubRep === "Arnold") && (l.statusBucket === "new" || l.statusBucket === "active")
    ).length;

    return NextResponse.json({
      tunnelUp,
      engine,
      webhookConfigured: Boolean(config.arnoldWebhookUrl),
      claudeFallback: integrationStatus().claudeFallback,
      pendingDrafts,
      sentToday,
      lastDraftAt,
      queue,
    });
  } catch (err) {
    return jsonError(err);
  }
}
