import { NextRequest, NextResponse } from "next/server";
import { applyStaleAssignments, wakeExpiredSnoozes, getLeads } from "@/lib/leads";
import { canWrite } from "@/lib/sheets";
import { integrationStatus, config } from "@/lib/config";
import { notifyTelegram } from "@/lib/arnold";
import { requireSession, jsonError } from "@/lib/api";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Sync status: counts + integration readiness. */
export async function GET(req: NextRequest) {
  const guard = requireSession(req);
  if (guard) return guard;
  try {
    const { leads } = await getLeads();
    const stale = leads.filter((l) => l.isStale);
    return NextResponse.json({
      totalLeads: leads.length,
      staleLeads: stale.length,
      staleNotYetArnold: stale.filter((l) => l.rep !== config.staleRep).length,
      writeEnabled: canWrite(),
      integrations: integrationStatus(),
      rules: { staleDays: config.staleDays, defaultRep: config.defaultRep, staleRep: config.staleRep },
    });
  } catch (err) {
    return jsonError(err);
  }
}

/**
 * Run the stale sweep: persist "30+ days no contact → assign Arnold" back to
 * the Leads Log sheet. (The UI already displays the rule either way.)
 */
export async function POST(req: NextRequest) {
  const guard = requireSession(req);
  if (guard) return guard;
  try {
    const woken = await wakeExpiredSnoozes();
    const reassigned = await applyStaleAssignments();
    if (reassigned.length) {
      notifyTelegram(
        `🤖 <b>Arnold picked up ${reassigned.length} stale lead(s)</b> (${config.staleDays}+ days no contact):\n` +
          reassigned.map((l) => `• ${l.name} — ${l.headline || l.leadType}`).join("\n")
      ).catch(() => {});
    }
    if (woken.length) {
      notifyTelegram(
        `⏰ <b>${woken.length} snoozed lead(s) woke up</b> and are active again:\n` +
          woken.map((l) => `• ${l.name} — ${l.headline || l.leadType}`).join("\n")
      ).catch(() => {});
    }
    return NextResponse.json({
      reassigned: reassigned.map((l) => ({ id: l.id, name: l.name })),
      woken: woken.map((l) => ({ id: l.id, name: l.name })),
    });
  } catch (err) {
    return jsonError(err);
  }
}
