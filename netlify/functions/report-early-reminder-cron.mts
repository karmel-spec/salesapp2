/**
 * Early weekly-report reminders for people who asked for one (Walter 10/16:
 * Korban wanted his before the 6 PM sweep). Thursdays, each person at their own
 * Denver time; skipped if their report for the week is already on the sheet.
 * The 6 PM thursday-report-sweep still reminds anyone still missing.
 * Add someone: one line in EARLY. "weekly report" in the text keeps it out of
 * the quiet-hours hold (it's an exempt keyword).
 */
import { REPORT_SHEET, sheetGet, notify, denver } from "./_blp-sched-lib.mts";

const EARLY: { name: string; hour: number; minute: number }[] = [
  { name: "Korban", hour: 16, minute: 30 },
];
const LINK = "https://blpshop.netlify.app/#report";

function weekKey(s: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(String(s || "").trim());
  if (!m) return null;
  const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  const d = new Date(Date.UTC(y, Number(m[1]) - 1, Number(m[2]), 12));
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}`;
}

export default async () => {
  const n = denver();
  if (n.weekday !== "Thu") return new Response("not Thursday");
  const due = EARLY.filter(e => e.hour === n.h && Math.abs(e.minute - n.min) <= 5);
  if (!due.length) return new Response("nobody due now");
  const rows = await sheetGet(REPORT_SHEET, `'${n.y}'!A1:BZ60`).catch(() => [] as string[][]);
  const header = rows[0] || [];
  const wk = weekKey(`${n.m}/${n.d}/${n.y}`);
  const col = header.findIndex(h => weekKey(String(h || "")) === wk);
  const out: string[] = [];
  for (const e of due) {
    const row = rows.find(r => String(r[0] || "").trim().toLowerCase().split(/\s+/)[0] === e.name.toLowerCase());
    if (col >= 0 && row && String(row[col] || "").trim()) { out.push(`${e.name}: already in`); continue; }
    const r = await notify(e.name, `📝 Hi ${e.name}, a reminder that your weekly report is due by 6 PM today: ${LINK}  Thanks!`);
    out.push(`${e.name}: ${r.sent ? "texted" : "not sent (" + (r.reason || "?") + ")"}`);
  }
  console.log("report-early-reminder", out.join("; "));
  return new Response(out.join("; "));
};

// 22:30 and 23:30 UTC Thursday = 4:30 PM Denver in MDT and in MST; the Denver
// check above lets exactly one of them through
export const config = { schedule: "30 22,23 * * 4" };
