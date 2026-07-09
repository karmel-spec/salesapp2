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
    // Is his brain reachable (tunnel + gateway on the Mac)?
    let tunnelUp = false;
    try {
      const res = await fetch("https://arnold.brighamlarsonpianos.com/health", {
        signal: AbortSignal.timeout(5000),
        cache: "no-store",
      });
      tunnelUp = res.ok;
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
