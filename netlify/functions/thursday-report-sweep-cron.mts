/**
 * Thursday 6:00 PM Denver — weekly-report sweep: remind technicians (+Doris)
 * whose weekly report is missing, then text Brigham + Karmel the GO / NOT GO
 * verdict for Friday's scheduling. Replaces the desktop Claude task (Brigham
 * 9/11). Cron is UTC: Fri 00:00 = Thu 6 PM MDT, Fri 01:00 = Thu 6 PM MST;
 * the Denver guard lets exactly one fire.
 */
import { REPORT_SHEET, SITE, KEY, sheetGet, sheetAppend, notify, denver } from "./_blp-sched-lib.mts";

const REMINDER = "⏰ BLP reminder: your weekly report was due today (Thursday) at 6 PM and has not been received. Brigham and Mark build next week's schedule from these reports FRIDAY MORNING — please open the shop app → My Weekly Report and submit it tonight. Thanks!";

export default async () => {
  const now = denver();
  if (now.weekday !== "Thu" || now.h !== 18) return new Response("not the Thursday 6 PM Denver hour", { status: 200 });
  // labels: this week's Friday (tomorrow) then today/Thursday, M/D/YY without
  // leading zeros. Both are accepted because the year tab's headers have used
  // each at different times; since 9/21 they are all Thursdays, so a MISSING
  // column is reported as the Thursday one (labels[1]) rather than the Friday.
  const today = new Date(Date.UTC(now.y, now.m - 1, now.d));
  const fri = new Date(today.getTime() + 86400000);
  const lab = (d: Date) => `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${String(d.getUTCFullYear()).slice(2)}`;
  const labels = [lab(fri), lab(today)];
  const year = String(now.y);
  let rows: string[][] = [];
  try { rows = await sheetGet(REPORT_SHEET, `'${year}'!A1:BA60`); } catch (e) { console.error("year tab", String(e)); }
  const header = rows[0] || [];
  let col = header.findIndex(h => labels.includes(String(h || "").trim()));
  /* Required reporters: the year tab's OWN rows, minus report_exempt.
   *
   * This used to come from the roster as
   *     pos = String(r[3] || r[2] || "")   … if (/tech/.test(pos))
   * but the PROJECTED roster columns are First | Last | Position | Start date,
   * so r[3] is the START DATE — "7/12/2002" never matches /tech/. The list
   * silently collapsed to Doris, the one name checked explicitly, so the
   * Thursday chase texted nobody else and the GO / NOT GO verdict sent to
   * Brigham and Karmel was computed over a single person (Walter 9/21).
   *
   * Fixing the index alone would not be enough: /tech/ matches only "Piano
   * Shop Technician", missing every Piano Rebuilder, Refinisher and Intern —
   * most of the shop. The year tab already lists exactly who reports each
   * week, Brigham and Karmel curate it, and the Planner reads the same tab,
   * so there is no second list to keep in step. */
  let required: string[] = rows.slice(1)
    .map(r => String(r[0] || "").trim())
    .filter(Boolean);
  let exempt = ["victoria"];
  try { const sj = await (await fetch(`${SITE}/.netlify/functions/app-settings?key=${encodeURIComponent(KEY())}`)).json() as any; const ex = sj && sj.settings && sj.settings.report_exempt; if (ex) exempt = String(ex).split(",").map(s => s.trim().toLowerCase()).filter(Boolean); } catch { /* keep default */ }
  required = [...new Set(required)].filter(n => !exempt.includes(n.toLowerCase()));
  const submitted: string[] = [], missing: string[] = [];
  for (const name of required) {
    const row = rows.find(r => String(r[0] || "").trim().toLowerCase().split(/\s+/)[0] === name.toLowerCase());
    const has = col >= 0 && row && String(row[col] || "").trim() !== "";
    (has ? submitted : missing).push(name);
  }
  const reminded: string[] = [], failed: string[] = [];
  for (const name of missing) { const r = await notify(name, REMINDER); if (r.sent) reminded.push(name); else failed.push(`${name} (${r.reason || "not sent"})`); }
  const verdict = missing.length ? `🔴 SCHEDULING NOT GO YET — missing: ${missing.join(", ")}. (The Planner falls back to their last week's report, so scheduling can still proceed if needed.)`
    : "🟢 SCHEDULING IS GO — all technician reports in.";
  const summary = `${verdict}\n\nWeek column: ${col >= 0 ? header[col] : "not created yet (expected " + labels[1] + ")"} · required: ${required.length}\nSubmitted: ${submitted.join(", ") || "—"}\nReminded tonight: ${reminded.join(", ") || "—"}${failed.length ? "\nCould not text: " + failed.join("; ") : ""}\n— Claude (Thursday sweep)`;
  const b = await notify("Brigham", summary); const k = await notify("Karmel", summary);
  try { await sheetAppend(REPORT_SHEET, "App Updates", [new Date().toISOString(), `⏰ Thursday report sweep: ${missing.length ? "missing " + missing.join(", ") : "all in"}; reminded ${reminded.length}; verdict texted to Brigham + Karmel.`, "Claude (Netlify scheduled)", "(log only)"]); } catch { /* best-effort */ }
  console.log("thursday-report-sweep", { required, submitted, missing, reminded, failed, b, k });
  return new Response(JSON.stringify({ ok: true, required, submitted, missing, reminded, failed }), { headers: { "content-type": "application/json" } });
};
export const config = { schedule: "0 0,1 * * 5" };
