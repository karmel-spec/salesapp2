import { NextRequest, NextResponse } from "next/server";
import { getLeads, type Lead, type TimelineEvent } from "@/lib/leads";
import { requireSession, jsonError } from "@/lib/api";
import { isValidArnoldKey } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Raw material for Arnold's Mon–Fri morning brief PDF: everything factual
 * about the last N hours (default 24), computed deterministically so his
 * report never misremembers. He adds narrative + top-10 recommendations.
 */

const CONTACT_OUT = ["sms_out", "email_out", "call"];

function inWindow(ev: TimelineEvent, since: number): boolean {
  const t = Date.parse(ev.at);
  return !Number.isNaN(t) && t >= since;
}

function lastDirection(l: Lead): "inbound" | "outbound" | "none" {
  for (let i = l.timeline.length - 1; i >= 0; i--) {
    const k = l.timeline[i].kind;
    if (k === "inbound") return "inbound";
    if (CONTACT_OUT.includes(k)) return "outbound";
  }
  return "none";
}

export async function GET(req: NextRequest) {
  const guard = requireSession(req);
  if (guard && !isValidArnoldKey(req.headers.get("x-blp-key"))) return guard;
  try {
    const hours = Number(req.nextUrl.searchParams.get("hours") || 24);
    const since = Date.now() - hours * 3600_000;
    const { leads } = await getLeads(true);
    const brief = {
      generatedAt: new Date().toISOString(),
      windowHours: hours,

      // Complete list: every customer response (text + email) in the window.
      customerResponses: leads.flatMap((l) =>
        l.timeline.filter((ev) => ev.kind === "inbound" && inWindow(ev, since)).map((ev) => ({
          lead: l.name, leadId: l.id, rep: l.effectiveRep, subRep: l.effectiveSubRep || undefined,
          at: ev.at, text: ev.text.slice(0, 400),
        }))
      ),

      // Every outbound touch in the window (who sent what).
      outboundActivity: leads.flatMap((l) =>
        l.timeline.filter((ev) => CONTACT_OUT.includes(ev.kind) && inWindow(ev, since)).map((ev) => ({
          lead: l.name, leadId: l.id, kind: ev.kind, who: ev.who, at: ev.at, text: ev.text.slice(0, 200),
        }))
      ),

      // Status changes in the window, with the lead's current status.
      statusChanges: leads.flatMap((l) =>
        l.timeline
          .filter((ev) => ev.kind === "edit" && /status/i.test(ev.text) && inWindow(ev, since))
          .map((ev) => ({ lead: l.name, leadId: l.id, at: ev.at, by: ev.who, nowStatus: l.status }))
      ),

      // Complete list of new leads in the window.
      newLeads: leads
        .filter((l) => l.timeline.some((ev) => ev.kind === "created" && inWindow(ev, since)))
        .map((l) => ({
          name: l.name, leadId: l.id, headline: l.headline, leadType: l.leadType,
          source: l.source, openedBy: l.openedBy || l.effectiveRep, heat: l.score,
          hasPhone: Boolean(l.phoneDialable), hasEmail: Boolean(l.emailClean),
        })),

      // Sub-rep leads (Arnold helping a human owner): detailed window activity.
      subRepDetail: leads
        .filter((l) => l.effectiveSubRep === "Arnold" && (l.statusBucket === "new" || l.statusBucket === "active"))
        .map((l) => ({
          lead: l.name, leadId: l.id, owner: l.effectiveRep, heat: l.score,
          daysQuiet: l.daysSinceContact, pendingDrafts: l.drafts.filter((d) => d.status === "pending").length,
          windowEvents: l.timeline.filter((ev) => inWindow(ev, since)).map((ev) => ({ at: ev.at, kind: ev.kind, who: ev.who, text: ev.text.slice(0, 160) })),
        })),

      // Arnold-owned leads: aggregates only (general reporting terms).
      arnoldOwned: (() => {
        const own = leads.filter((l) => l.effectiveRep === "Arnold" && (l.statusBucket === "new" || l.statusBucket === "active"));
        const drafts = own.flatMap((l) => l.drafts);
        return {
          openLeads: own.length,
          withPendingDraft: own.filter((l) => l.drafts.some((d) => d.status === "pending")).length,
          draftsSentInWindow: own.flatMap((l) => l.timeline).filter((ev) => CONTACT_OUT.includes(ev.kind) && inWindow(ev, since)).length,
          totalPendingDrafts: drafts.filter((d) => d.status === "pending").length,
        };
      })(),

      // Candidates for the top-10 recommendations (Arnold picks and explains).
      topCandidates: leads
        .filter((l) => (l.statusBucket === "new" || l.statusBucket === "active") && l.effectiveRep !== "Arnold")
        .map((l) => ({
          lead: l.name, leadId: l.id, rep: l.effectiveRep, subRep: l.effectiveSubRep || undefined,
          heat: l.score, daysQuiet: l.daysSinceContact, ourTurn: lastDirection(l) === "inbound",
          headline: l.headline, leadType: l.leadType, value: l.value,
          pendingDrafts: l.drafts.filter((d) => d.status === "pending").length,
          newestFollowupNote: [...l.timeline].reverse().find((ev) => ev.kind === "followup")?.text?.slice(0, 200),
        }))
        .sort((a, b) => (Number(b.ourTurn) - Number(a.ourTurn)) || (Number(b.heat) || 0) - (Number(a.heat) || 0))
        .slice(0, 30),
    };
    return NextResponse.json(brief);
  } catch (err) {
    return jsonError(err);
  }
}
