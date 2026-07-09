import { NextRequest, NextResponse } from "next/server";
import { applyStaleAssignments, wakeExpiredSnoozes, getLeads, tidySheetSections } from "@/lib/leads";
import { canWrite } from "@/lib/sheets";
import { integrationStatus, config } from "@/lib/config";
import { notifyTelegram } from "@/lib/arnold";
import { requireSession, jsonError } from "@/lib/api";
import { isValidArnoldKey } from "@/lib/auth";

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
      staleNotYetArnold: stale.filter((l) => l.rep !== config.staleRep && l.subRep !== config.staleRep).length,
      writeEnabled: canWrite(),
      integrations: integrationStatus(),
      rules: { staleDays: config.staleDays, defaultRep: config.defaultRep, staleRep: config.staleRep },
    });
  } catch (err) {
    return jsonError(err);
  }
}

/**
 * Run the stale sweep: persist the quiet-lead rules (never-contacted 10d /
 * worked 30d → assign Arnold) back to
 * the Leads Log sheet. (The UI already displays the rule either way.)
 */
export async function POST(req: NextRequest) {
  const guard = requireSession(req);
  if (guard && !isValidArnoldKey(req.headers.get("x-blp-key"))) return guard;
  try {
    const body = (await req.json().catch(() => ({}))) as { action?: string };

    if (body.action === "tidy") {
      // Re-file snoozed/won/lost rows from the working area to their sections.
      const { moved } = await tidySheetSections();
      if (moved.length) {
        notifyTelegram(
          `🧹 <b>Leads Log tidied</b> — ${moved.length} row(s) re-filed: ` +
            moved.map((m) => `${m.name} → ${m.bucket.toUpperCase()}`).join(", ")
        ).catch(() => {});
      }
      return NextResponse.json({ moved });
    }

    const woken = await wakeExpiredSnoozes();
    const reassigned = await applyStaleAssignments();
    if (reassigned.length) {
      notifyTelegram(
        `🤖 <b>Arnold joined ${reassigned.length} quiet lead(s) as sub-rep</b> (primary reps keep them):\n` +
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
