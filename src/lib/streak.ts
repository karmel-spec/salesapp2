import type { Lead } from "./leads";

/**
 * Sales streaks — the daily-puzzle habit loop, for leads. A lead counts as
 * "worked" on a day when the rep put a human touch on it (text, email, call,
 * note, edit, coaching, filing). Streaks count BUSINESS days only: weekends
 * and shop holidays never break a streak.
 */
const TZ = "America/Denver";
const WORK = new Set(["sms_out", "email_out", "call", "call_attempt", "note", "edit", "coaching", "file", "followup"]);

export interface DayCount { date: string; count: number; leads: string[] }
export interface Streak {
  who: string;
  today: DayCount;
  streak: number; // consecutive business days (through today, or through the last business day if today has no work yet)
  streakAlive: boolean; // true when today already counts
  tenStreak: number; // consecutive business days with 10+
  best: { count: number; date: string } | null; // all-time best day (before today if today is the new best, see bestBeforeToday)
  bestBeforeToday: { count: number; date: string } | null;
  history: DayCount[]; // newest first, last 30 days with any work
  generatedAt: string;
}

export const dayKey = (d: Date | string) => new Date(d).toLocaleDateString("en-CA", { timeZone: TZ }); // YYYY-MM-DD

/** Shop holidays (observed): New Year's, Memorial Day, July 4, Pioneer Day (UT), Labor Day, Thanksgiving + Friday, Christmas Eve/Day. */
export function isHoliday(date: string): boolean {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = dt.getUTCDay();
  const nthWeekday = (month: number, weekday: number, n: number) => { const first = new Date(Date.UTC(y, month - 1, 1)).getUTCDay(); return 1 + ((weekday - first + 7) % 7) + (n - 1) * 7; };
  const lastWeekday = (month: number, weekday: number) => { const last = new Date(Date.UTC(y, month, 0)); const lw = last.getUTCDay(); return last.getUTCDate() - ((lw - weekday + 7) % 7); };
  const fixed = new Set([`${y}-01-01`, `${y}-07-04`, `${y}-07-24`, `${y}-12-24`, `${y}-12-25`]);
  if (fixed.has(date)) return true;
  if (m === 5 && d === lastWeekday(5, 1)) return true; // Memorial Day
  if (m === 9 && d === nthWeekday(9, 1, 1)) return true; // Labor Day
  if (m === 11 && (d === nthWeekday(11, 4, 4) || d === nthWeekday(11, 4, 4) + 1)) return true; // Thanksgiving + Friday
  // Observed: a fixed holiday on Sat → Fri, on Sun → Mon
  for (const f of fixed) { const fd = new Date(f + "T00:00:00Z"); const fdow = fd.getUTCDay(); const obs = new Date(fd); if (fdow === 6) obs.setUTCDate(fd.getUTCDate() - 1); else if (fdow === 0) obs.setUTCDate(fd.getUTCDate() + 1); else continue; if (obs.toISOString().slice(0, 10) === date) return true; }
  return dow === 0 || dow === 6 ? false : false;
}
export const isBusinessDay = (date: string) => { const dow = new Date(date + "T12:00:00Z").getUTCDay(); return dow !== 0 && dow !== 6 && !isHoliday(date); };
const prevDay = (date: string) => { const dt = new Date(date + "T12:00:00Z"); dt.setUTCDate(dt.getUTCDate() - 1); return dt.toISOString().slice(0, 10); };
const prevBusinessDay = (date: string) => { let d = prevDay(date); while (!isBusinessDay(d)) d = prevDay(d); return d; };

export function computeStreak(leads: Lead[], who: string, now = new Date()): Streak {
  const per = new Map<string, Map<string, string>>(); // date → leadId → name
  const w = who.toLowerCase();
  for (const l of leads) {
    for (const e of l.timeline) {
      if (!WORK.has(e.kind) || (e.who || "").toLowerCase() !== w) continue;
      const d = dayKey(e.at);
      if (!per.has(d)) per.set(d, new Map());
      per.get(d)!.set(l.id, l.name);
    }
  }
  const today = dayKey(now);
  const count = (d: string) => per.get(d)?.size || 0;
  const mk = (d: string): DayCount => ({ date: d, count: count(d), leads: [...(per.get(d)?.values() || [])] });

  // Streak: walk back over business days from today (or from the last business day if today is empty so far).
  let streak = 0;
  let cursor = isBusinessDay(today) ? today : prevBusinessDay(today);
  const streakAlive = count(today) > 0;
  if (!streakAlive) cursor = prevBusinessDay(cursor);
  while (count(cursor) > 0) { streak++; cursor = prevBusinessDay(cursor); if (streak > 400) break; }
  if (!streakAlive && !isBusinessDay(today)) { /* weekend: streak carries as-is */ }

  let tenStreak = 0;
  let c2 = isBusinessDay(today) ? today : prevBusinessDay(today);
  if (count(today) < 10) c2 = prevBusinessDay(c2);
  while (count(c2) >= 10) { tenStreak++; c2 = prevBusinessDay(c2); if (tenStreak > 400) break; }

  const days = [...per.keys()].sort();
  const bestOf = (ds: string[]) => ds.reduce<{ count: number; date: string } | null>((b, d) => (count(d) > (b?.count || 0) ? { count: count(d), date: d } : b), null);
  return {
    who,
    today: mk(today),
    streak,
    streakAlive,
    tenStreak,
    best: bestOf(days),
    bestBeforeToday: bestOf(days.filter((d) => d < today)),
    history: days.filter((d) => d >= dayKey(new Date(now.getTime() - 30 * 86400_000))).sort().reverse().map(mk),
    generatedAt: now.toISOString(),
  };
}
