import { NextRequest, NextResponse } from "next/server";
import { getLeads } from "@/lib/leads";
import { computeStreak, dayKey } from "@/lib/streak";
import { trackTeamQuestions } from "@/lib/teamq";
import { rankLeads, workedSince } from "@/lib/topten-auto";
import { getTopTen } from "@/lib/topten";
import { scopeOf } from "@/lib/inbox-split";
import { computeWins } from "@/lib/wins";
import { requireSession, jsonError } from "@/lib/api";
import { config } from "@/lib/config";

export const dynamic = "force-dynamic";

/** GET /api/streak?who=Brigham — today's worked-lead count, business-day streak, best day. */
export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get("key") !== config.accessKey) {
    const guard = requireSession(req);
    if (guard) return guard;
  }
  try {
    const who = (req.nextUrl.searchParams.get("who") || "Brigham").trim();
    const { leads } = await getLeads(req.nextUrl.searchParams.get("fresh") === "1");
    const base = { ...computeStreak(leads, who), wins: computeWins(leads, who) };
    if (who !== "Brigham") return NextResponse.json(base);

    // "All clear" = every new lead contacted, today's Top Ten worked, no unread replies to Brigham.
    const OUT = new Set(["sms_out", "email_out", "call", "call_attempt"]);
    const mine = leads.filter((l) => l.effectiveRep === "Brigham");
    const newUncontacted = mine.filter((l) => l.statusBucket === "new" && !l.timeline.some((e) => OUT.has(e.kind))).length;
    const saved = await getTopTen("brigham").catch(() => null);
    const fresh = saved && Date.now() - Date.parse(saved.savedAt) < 36 * 3600_000;
    const boosts = new Map(fresh ? saved!.items.map((x) => [x.leadId, x.reason] as [string, string]) : []);
    const startOfToday = new Date(`${dayKey(new Date())}T06:00:00.000Z`).toISOString(); // ~midnight Denver
    const ten = rankLeads(leads, "Brigham", new Set(), boosts);
    const topTenLeft = ten.filter((x) => { const l = leads.find((y) => y.id === x.leadId); return l && !workedSince(l, saved && fresh ? saved.savedAt : startOfToday); }).length;
    let unreadReplies = 0;
    for (const l of leads) for (const e of l.timeline) if (e.kind === "inbound" && !e.readAt && scopeOf(l, e) === "brigham") unreadReplies++;
    const allClear = { newUncontacted, topTenLeft, unreadReplies, clear: newUncontacted === 0 && topTenLeft === 0 && unreadReplies === 0 };
    const teamQuestions = await trackTeamQuestions().catch(() => null);
    return NextResponse.json({ ...base, allClear, teamQuestions });
  } catch (err) {
    return jsonError(err);
  }
}
