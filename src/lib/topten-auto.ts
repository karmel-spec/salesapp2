import type { Lead } from "./leads";
import type { TopTenItem } from "./topten";

/**
 * Live ranking of a rep's open leads for the TOP TEN screens — "who should I
 * work right now": customers waiting on us, deals with a next step in motion,
 * revenue, heat, and recent engagement. Leads who said "later", ghost us, or
 * have gone cold sink. Arnold's morning picks add a boost (his judgment
 * counts) but can't carry a stale lead into the ten by themselves.
 */
const LATER = /\b(later|next (year|spring|summer|fall|winter)|down the road|not (right )?now|not interested|no longer|hold off|holding off|after the (summer|holidays)|in (a few|several|six|6) months|kick the can|check back (in|next)|circle back (in|next)|maybe someday)\b/i;
const READY = /\b(schedul|appointment|visit|coming in|come (by|in)|stop(ping)? by|deposit|quote|invoice|ready to|approved|financ|pick ?up|deliver|contract|sign|move forward|let'?s do it|go ahead)\b/i;
const OUTREACH = new Set(["sms_out", "email_out", "call", "call_attempt"]);

export function rankLeads(leads: Lead[], rep: "Brigham" | "Arnold", exclude: Set<string> = new Set(), boosts: Map<string, string> = new Map()): TopTenItem[] {
  const pool = leads.filter((l) => l.effectiveRep === rep && (l.statusBucket === "active" || l.statusBucket === "new") && !exclude.has(l.id));
  const money = (v: string) => {
    const m = /\$?\s*(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(k)?/i.exec(v || "");
    if (!m) return 0;
    const n = Number(m[1].replace(/,/g, "")) * (m[2] ? 1000 : 1);
    return isFinite(n) && n < 5_000_000 ? n : 0;
  };
  const now = Date.now();
  const scored = pool.map((l) => {
    const heat = Math.min(10, Math.max(0, Number(l.score) || 0));
    const value = money(l.value);
    const tl = [...l.timeline].sort((a, b) => a.at.localeCompare(b.at));
    const inbound = tl.filter((e) => e.kind === "inbound");
    const awaiting = inbound.some((e) => !e.readAt);
    const lastIn = inbound[inbound.length - 1];
    const inDays = lastIn ? Math.floor((now - Date.parse(lastIn.at)) / 86400_000) : null;
    const attempts = tl.filter((e) => OUTREACH.has(e.kind)).length;
    const everReplied = inbound.length > 0;
    const ghosting = !everReplied && attempts >= 3;
    const drafts = l.drafts.filter((d) => d.status === "pending").length;
    const quiet = l.daysSinceContact;
    const recentText = tl.slice(-6).map((e) => e.text || "").join(" ");
    const recentCustomer = inbound.slice(-3).map((e) => e.text || "").join(" ");
    const saidLater = LATER.test(recentCustomer) || LATER.test(l.headline || "");
    const ready = READY.test(recentText) || READY.test(l.headline || "");
    const boost = boosts.get(l.id);
    let pts = 0;
    if (awaiting) pts += 40;
    if (everReplied) pts += 12;
    if (inDays !== null) pts += inDays <= 2 ? 18 : inDays <= 7 ? 12 : inDays <= 21 ? 5 : 0;
    pts += heat * 4;
    pts += value >= 20000 ? 20 : value >= 10000 ? 15 : value >= 5000 ? 10 : value > 0 ? 5 : 0;
    if (ready) pts += 15;
    pts += Math.min(drafts, 3) * 4;
    if (l.statusBucket === "new") pts += 8;
    if (boost) pts += 15;
    if (saidLater) pts -= 35;
    if (ghosting) pts -= 30;
    if (inDays !== null && inDays > 21 && !awaiting) pts -= 15; // engagement has gone cold
    if (quiet !== null && quiet > 60) pts -= 10;
    const why: string[] = [];
    if (awaiting) why.push("customer replied — waiting on us");
    if (ready) why.push("next step in motion");
    if (heat >= 7) why.push(`heat ${heat}/10`); else if (heat) why.push(`heat ${heat}/10`);
    if (value) why.push(`$${value.toLocaleString()}`);
    if (inDays !== null) why.push(inDays === 0 ? "wrote today" : `last wrote ${inDays}d ago`);
    if (drafts) why.push(`${drafts} draft${drafts > 1 ? "s" : ""} waiting`);
    if (l.statusBucket === "new") why.push("new lead");
    if (saidLater) why.push("⚠️ customer said later");
    if (ghosting) why.push(`⚠️ never replied after ${attempts} attempts`);
    if (boost) why.push(`⭐ Arnold's pick: ${boost}`);
    return { l, pts, reason: why.join(" · ") || `active lead assigned to ${rep}` };
  });
  scored.sort((a, b) => b.pts - a.pts || (a.l.daysSinceContact ?? 999) - (b.l.daysSinceContact ?? 999));
  return scored.slice(0, 10).map((x, i) => ({ rank: i + 1, leadId: x.l.id, leadName: x.l.name, reason: x.reason }));
}

/** "Worked" since the list was made: any human touch (note, text, email, call, status/field edit, filing). */
export function workedSince(l: Lead, savedAt: string): boolean {
  if (["won", "lost", "closed", "inactive", "unqualified"].includes(l.statusBucket)) return true;
  return l.timeline.some((e) => e.at > savedAt && !["inbound", "draft", "created"].includes(e.kind) && !/^arnold$/i.test(e.who));
}
