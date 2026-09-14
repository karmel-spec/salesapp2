import type { Lead } from "./leads";
import type { TopTenItem } from "./topten";

/**
 * Live ranking of a rep's open leads for the TOP TEN screens. Signals, in
 * order of weight: a customer reply nobody has answered, heat (1-10), dollar
 * value, drafts waiting for approval, and how long the lead has gone quiet
 * (due for a touch is good; months of silence is not).
 */
export function rankLeads(leads: Lead[], rep: "Brigham" | "Arnold", exclude: Set<string> = new Set()): TopTenItem[] {
  const pool = leads.filter((l) => l.effectiveRep === rep && (l.statusBucket === "active" || l.statusBucket === "new") && !exclude.has(l.id));
  const money = (v: string) => { const n = Number((v || "").replace(/[^\d.]/g, "")); return isFinite(n) ? n : 0; };
  const scored = pool.map((l) => {
    const heat = Number(l.score) || 0;
    const value = money(l.value);
    const awaiting = l.timeline.some((e) => e.kind === "inbound" && !e.readAt);
    const lastIn = l.timeline.filter((e) => e.kind === "inbound").map((e) => e.at).sort().pop();
    const inDays = lastIn ? Math.floor((Date.now() - Date.parse(lastIn)) / 86400_000) : null;
    const drafts = l.drafts.filter((d) => d.status === "pending").length;
    const quiet = l.daysSinceContact;
    let pts = 0;
    if (awaiting) pts += 40;
    pts += heat * 4;
    pts += value >= 20000 ? 20 : value >= 10000 ? 15 : value >= 5000 ? 10 : value > 0 ? 5 : 0;
    pts += Math.min(drafts, 3) * 5;
    if (inDays !== null) pts += inDays <= 2 ? 15 : inDays <= 7 ? 10 : inDays <= 30 ? 4 : 0;
    if (quiet !== null) pts += quiet >= 14 && quiet <= 60 ? 6 : quiet > 60 ? -5 : 0;
    if (l.statusBucket === "new") pts += 8;
    const why: string[] = [];
    if (awaiting) why.push("customer replied — no answer yet");
    if (heat) why.push(`heat ${heat}/10`);
    if (value) why.push(`$${value.toLocaleString()}`);
    if (drafts) why.push(`${drafts} draft${drafts > 1 ? "s" : ""} waiting for approval`);
    if (inDays !== null) why.push(inDays === 0 ? "wrote today" : `last wrote ${inDays}d ago`);
    if (quiet !== null && quiet >= 14) why.push(`${quiet}d since we reached out`);
    if (l.statusBucket === "new") why.push("new lead");
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
