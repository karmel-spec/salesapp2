/**
 * Weekly-report reminders for people who are OUT on the Thursday reports are
 * due (Walter 10/15, option C). Hunter and Myrrhanda were both off on
 * Thursday 10/15 and the only reminder was the 6 PM sweep.
 *
 *  - 2 PM on a person's LAST WORKDAY before that Thursday, when it falls in
 *    the same week (Mon–Wed): the Shop app files a report under the week it
 *    is sent in, so a heads-up the Friday before a whole week off can't be
 *    acted on — those people get only the Thursday nudge.
 *  - 10 AM Thursday: anyone out that day whose report still isn't in (also
 *    catches time off approved after the 2 PM heads-up).
 *
 * "Out" = the Time Off tab (approved or still pending — not denied) covers the
 * day, or the Team Schedule tab has a blank cell for that weekday. Required
 * reporters = the year tab's rows minus App Settings report_exempt — the same
 * list as the 6 PM thursday-report-sweep, which is unchanged. Nobody whose
 * report for that week is already on the sheet is texted.
 */
import { REPORT_SHEET, SITE, KEY, sheetGet, notify } from "../_blp-sched-lib.mts";

const LINK = "https://blpshop.netlify.app/#report";
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400000);
const md = (d: Date) => `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
const first = (s: string) => String(s || "").trim().toLowerCase().split(/\s+/)[0] || "";
/** Monday of the week a "M/D/YY" header falls in (same rule as weekly-report.mts) */
function weekKey(s: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(String(s || "").trim());
  if (!m) return null;
  const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  const d = new Date(Date.UTC(y, Number(m[1]) - 1, Number(m[2]), 12));
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}`;
}
const weekOf = (d: Date) => weekKey(`${d.getUTCMonth() + 1}/${d.getUTCDate()}/${d.getUTCFullYear()}`);

export type Plan = { kind: "heads-up" | "thursday"; name: string; thursday: string; message: string; why: string };

/** who gets a reminder at `hour` (Denver) on `day` (YYYY-MM-DD, Denver date) */
export async function absencePlan(day: string, hour: number): Promise<{ plan: Plan[]; notes: string[] }> {
  const notes: string[] = [];
  const D = new Date(day + "T12:00:00Z");
  const dow = D.getUTCDay();
  const isHeadsUp = hour === 14 && dow >= 1 && dow <= 5;
  const isThursday = hour === 10 && dow === 4;
  if (!isHeadsUp && !isThursday) return { plan: [], notes: ["not a reminder hour"] };
  // the Thursday that matters: this week's (today or later), or next week's on a Friday
  const T = addDays(D, ((4 - dow) + 7) % 7);

  const year = String(T.getUTCFullYear());
  const [rows, offRows, sched] = await Promise.all([
    sheetGet(REPORT_SHEET, `'${year}'!A1:BZ60`).catch(() => [] as string[][]),
    sheetGet(REPORT_SHEET, `'Time Off'!A2:G800`).catch(() => [] as string[][]),
    sheetGet(REPORT_SHEET, `'Team Schedule'!A1:H80`).catch(() => [] as string[][]),
  ]);
  const header = rows[0] || [];
  const wk = weekOf(T);
  const col = header.findIndex(h => weekKey(String(h || "")) === wk);
  let exempt = ["victoria"];
  try {
    const sj = await (await fetch(`${SITE}/.netlify/functions/app-settings?key=${encodeURIComponent(KEY())}`)).json() as any;
    const ex = sj && sj.settings && sj.settings.report_exempt;
    if (ex) exempt = String(ex).split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
  } catch { /* default */ }
  const required = [...new Set(rows.slice(1).map(r => String(r[0] || "").trim()).filter(Boolean))]
    .filter(n => !exempt.includes(n.toLowerCase()));
  const submitted = (name: string) => {
    const row = rows.find(r => first(r[0]) === first(name));
    return col >= 0 && !!row && String(row[col] || "").trim() !== "";
  };
  const off = offRows.filter(r => r[1] && !/denied|declined|rejected|cancel/i.test(String(r[6] || "")))
    .map(r => ({ who: first(r[1]), start: String(r[2] || "").slice(0, 10), end: String(r[3] || r[2] || "").slice(0, 10) }));
  const schedRow = (name: string) => sched.find(r => first(r[0]) === first(name) && (r[2] || r[3] || r[4] || r[5] || r[6]));
  const timeOff = (name: string, d: Date) => off.some(o => o.who === first(name) && o.start && o.start <= iso(d) && (o.end || o.start) >= iso(d));
  const scheduledOff = (name: string, d: Date) => {
    const r = schedRow(name); if (!r) return false;                       // not on the tab: assume Mon–Fri
    const c = { 1: 2, 2: 3, 3: 4, 4: 5, 5: 6, 6: 7 }[d.getUTCDay()];
    return c == null || !String(r[c] || "").trim();
  };
  const outOn = (name: string, d: Date) => timeOff(name, d) || scheduledOff(name, d);
  const works = (name: string, d: Date) => d.getUTCDay() >= 1 && d.getUTCDay() <= 5 && !outOn(name, d);

  const plan: Plan[] = [];
  for (const name of required) {
    if (!outOn(name, T)) continue;
    if (submitted(name)) { notes.push(`${name}: out ${md(T)}, report already in`); continue; }
    const fn = name.split(/\s+/)[0];
    const why = timeOff(name, T) ? "time off" : "not scheduled Thursdays";
    if (isHeadsUp) {
      // the last day they're in before that Thursday
      let last: Date | null = null;
      for (let x = addDays(T, -1); x >= D; x = addDays(x, -1)) { if (works(name, x)) { last = x; break; } }
      if (!last || iso(last) !== iso(D)) continue;
      if (weekOf(D) !== weekOf(T)) { notes.push(`${name}: out all of the week of ${md(T)} — Thursday nudge only`); continue; }
      plan.push({ kind: "heads-up", name, thursday: iso(T), why,
        message: `Heads-up, ${fn}: You’re out Thursday ${md(T)}, the day weekly reports are due. Please submit your weekly report before you leave today if you can: ${LINK}` });
    } else {
      plan.push({ kind: "thursday", name, thursday: iso(T), why,
        message: `📝 ${fn}, you're out today — just a reminder your weekly report is due by 6 PM. You can submit it from your phone: ${LINK}  Thanks!` });
    }
  }
  if (col < 0) notes.push(`no column yet for the week of ${md(T)} — everyone counts as not submitted`);
  return { plan, notes };
}

export async function sendAbsenceReminders(day: string, hour: number) {
  const { plan, notes } = await absencePlan(day, hour);
  const sent: string[] = [], failed: string[] = [];
  for (const p of plan) {
    const r = await notify(p.name.split(/\s+/)[0], p.message);
    (r.sent ? sent : failed).push(p.name + (r.sent ? "" : ` (${r.reason || "not sent"})`));
  }
  return { plan, notes, sent, failed };
}
