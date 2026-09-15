import type { Lead } from "./leads";
import { dayKey } from "./streak";

/** Sales wins (status Won) with the month / year / all-time tallies for the WON celebration. */
export interface WinTotals { count: number; dollars: number; mine: number }
export interface Wins {
  month: WinTotals & { label: string };
  year: WinTotals & { label: string };
  allTime: WinTotals;
  bestMonth: { label: string; count: number } | null;
  latest: { name: string; value: string; when: string; closedBy: string } | null;
}

export const money = (v: string) => {
  const m = /\$?\s*(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(k)?/i.exec(v || "");
  if (!m) return 0;
  const n = Number(m[1].replace(/,/g, "")) * (m[2] ? 1000 : 1);
  return isFinite(n) && n < 5_000_000 ? n : 0;
};

/** Best guess at when the lead was marked Won: the last "Updated status" edit, else last contact, else date added. */
export function wonAt(l: Lead): string {
  const edits = l.timeline.filter((e) => e.kind === "edit" && /status/i.test(e.text || "")).map((e) => e.at).sort();
  if (edits.length) return edits[edits.length - 1];
  const lc = (l as unknown as { lastContact?: string }).lastContact;
  const d = lc ? new Date(lc) : null;
  if (d && !isNaN(d.getTime())) return d.toISOString();
  const added = (l as unknown as { dateAdded?: string }).dateAdded;
  const a = added ? new Date(added) : null;
  return a && !isNaN(a.getTime()) ? a.toISOString() : new Date(0).toISOString();
}

export function computeWins(leads: Lead[], who: string, now = new Date()): Wins {
  const won = leads.filter((l) => l.statusBucket === "won").map((l) => ({ l, at: wonAt(l), day: dayKey(wonAt(l)) }));
  const today = dayKey(now);
  const ym = today.slice(0, 7), y = today.slice(0, 4);
  const w = who.toLowerCase();
  const isMine = (l: Lead) => (l.closedBy || l.effectiveRep || "").toLowerCase() === w;
  const tally = (list: typeof won): WinTotals => ({ count: list.length, dollars: list.reduce((s, x) => s + money(x.l.value), 0), mine: list.filter((x) => isMine(x.l)).length });
  const byMonth = new Map<string, number>();
  for (const x of won) byMonth.set(x.day.slice(0, 7), (byMonth.get(x.day.slice(0, 7)) || 0) + 1);
  const best = [...byMonth.entries()].sort((a, b) => b[1] - a[1])[0];
  const label = (k: string) => new Date(k + (k.length === 7 ? "-15" : "-06-15") + "T12:00:00").toLocaleDateString("en-US", k.length === 7 ? { month: "long", year: "numeric" } : { year: "numeric" });
  const latest = won.sort((a, b) => b.at.localeCompare(a.at))[0];
  return {
    month: { ...tally(won.filter((x) => x.day.startsWith(ym))), label: label(ym) },
    year: { ...tally(won.filter((x) => x.day.startsWith(y))), label: y },
    allTime: tally(won),
    bestMonth: best ? { label: label(best[0]), count: best[1] } : null,
    latest: latest ? { name: latest.l.name, value: latest.l.value, when: latest.at, closedBy: latest.l.closedBy || latest.l.effectiveRep || "" } : null,
  };
}
