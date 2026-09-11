/**
 * Friday 4:30 PM Denver — text Brigham (copy Karmel) the state of next week's
 * schedule proposal with a fixed review checklist, inviting him to review the
 * Planner and Approve. Replaces the desktop Claude task of the same name
 * (Brigham 9/11: internet-based, never dependent on a computer being on).
 * Cron is UTC: 22:30 = 4:30 PM MDT, 23:30 = 4:30 PM MST — the Denver-hour
 * guard below lets exactly one of the two fire each Friday.
 */
import { REPORT_SHEET, bridgeGet, sheetGet, sheetAppend, notify, denver, denverStamp } from "./_blp-sched-lib.mts";

const TENTATIVE = /tentative|tbd|placeholder|check with|\?/i;
const ASK_RE = /^(?:ask|questions? (?:for|4)|q'?s (?:for|4))\s+/i;

export default async () => {
  const now = denver();
  if (now.weekday !== "Fri" || now.h !== 16) return new Response("not the 4 PM Denver hour", { status: 200 });
  const j = await bridgeGet("fn=proposal", x => x && x.ok && x.plan);
  let text: string, state: string;
  if (!j) {
    state = "no proposal reachable";
    text = "📅 Next week's schedule — I could not reach the proposal on the Store Map bridge just now. Please open Store Map → Scheduler → Planner to check whether Mark's revision is saved, and Approve if it looks ready. — Claude";
  } else {
    const meta = j.meta || {};
    let plan: any = j.plan; if (typeof plan === "string") { try { plan = JSON.parse(plan); } catch { plan = {}; } }
    const saved = meta.savedAt ? new Date(meta.savedAt) : null;
    const savedD = saved ? denver(saved) : null;
    const savedToday = !!(savedD && savedD.y === now.y && savedD.m === now.m && savedD.d === now.d);
    const savedLabel = saved ? denverStamp(saved) : "unknown";
    const applied = !!meta.applied;
    const week = plan.week || meta.week || "next week";
    const issues: string[] = [];
    const techs: any[] = plan.techs || [];
    // 1. placeholder blocks
    const tent = new Set<string>();
    techs.forEach(t => (t.days || []).forEach((d: any[]) => (d || []).forEach(b => { if (TENTATIVE.test(String(b[3] || ""))) tent.add(`${t.name}: "${String(b[3]).slice(0, 50)}"`); })));
    if (tent.size) issues.push("Placeholder blocks that would go on calendars as-is — " + [...tent].slice(0, 4).join("; "));
    // 2. thin weeks
    techs.forEach(t => { const days = (t.days || []).filter((d: any[]) => d && d.length).length; if (days === 0) issues.push(`${t.name} has no blocks all week`); else if (days < 3 && !/off|field|intern|part|recovery|class/i.test(String(t.hours || "") + String(t.who || ""))) issues.push(`${t.name} has only ${days} working day(s) with no explanation in hours/who`); });
    // 3. same serial → 3+ techs same day
    for (let di = 0; di < 5; di++) {
      const bySerial: Record<string, Set<string>> = {};
      techs.forEach(t => ((t.days || [])[di] || []).forEach((b: any[]) => { const m = /\b(\d{4,7}|[A-Z0-9]{6,})\b/.exec(String(b[3] || "")); if (m) (bySerial[m[1]] = bySerial[m[1]] || new Set()).add(t.name); }));
      Object.entries(bySerial).forEach(([s, set]) => { if (set.size >= 3) issues.push(`${["Mon","Tue","Wed","Thu","Fri"][di]}: piano ${s} is on ${set.size} techs (${[...set].join(", ")})`); });
    }
    // 4. open bottlenecks
    (plan.bottlenecks || []).forEach((b: any) => { const title = String(b[0] || ""), body = String(b[1] || ""); if (title && !/resolved|confirmed|done|complete/i.test(body.slice(0, 120))) issues.push("Open: " + title.slice(0, 70)); });
    // 5. Tech Calendars coverage
    try {
      const tc = await sheetGet(REPORT_SHEET, "'Tech Calendars'!A2:B60");
      const calByFirst: Record<string, string> = {}; tc.forEach(r => { if (r[0]) calByFirst[String(r[0]).trim().toLowerCase()] = String(r[1] || "").trim(); });
      techs.forEach(t => { const f = String(t.name || "").split(/\s+/)[0].toLowerCase(); if (!(f in calByFirst)) issues.push(`${t.name} is not on the Tech Calendars tab (skipped on Apply)`); else if (!calByFirst[f]) issues.push(`${t.name} has no calendar ID on the Tech Calendars tab (skipped on Apply)`); });
    } catch { /* tab unreadable — skip this check */ }
    // 6. Korban tunings
    const korban = techs.find(t => /^korban/i.test(String(t.name || "")));
    if (korban) { const n = (korban.days || []).flat().filter((b: any[]) => /in-store tuning/i.test(String(b[3] || ""))).length; if (n < 10) issues.push(`Korban has ${n} in-store tunings scheduled (rule: 10/week)`); }
    // 7. blocks on off days
    techs.forEach(t => { const hrs = String(t.hours || ""); ["Mon","Tue","Wed","Thu","Fri"].forEach((dn, i) => { const off = new RegExp(`off\\s+[^)]*\\b${dn}`, "i").test(hrs) || new RegExp(`\\(${dn}[^)]*off\\)`, "i").test(hrs); if (off && ((t.days || [])[i] || []).length) issues.push(`${t.name} has blocks on ${dn} but hours say off`); }); });
    const glance = techs.map(t => `${String(t.name).split(/\s+/)[0]} ${String(t.who || "").replace(/\s+/g, " ").slice(0, 60)}`).join(" · ");
    let head: string;
    if (applied) { state = "already applied"; head = `📅 Next week's schedule (${week}) — already APPROVED and applied to the tech calendars (saved ${savedLabel}). Nothing needed unless you want changes.`; }
    else if (savedToday) { state = "revision saved today, awaiting Approve"; head = `📅 Next week's schedule (${week}) — Mark's final revision is saved (${savedLabel} today) and waiting for your Approve in Store Map → Scheduler → Planner.`; }
    else { state = "no revision today"; head = `📅 Next week's schedule (${week}) — Mark's final revision is NOT in yet; the newest proposal is from ${savedLabel}. Please review the Planner and Approve, or nudge Mark.`; }
    const uniq = [...new Set(issues)].slice(0, 7);
    text = head + (uniq.length ? "\n\nPlease consider before approving:\n" + uniq.map((s, i) => `${i + 1}) ${s}`).join("\n") : "\n\nNo review flags found.") + "\n\nWeek at a glance: " + glance + "\n\nIf it looks ready, click Approve in the Planner (no PIN needed). — Claude";
    if (text.length > 1550) text = text.slice(0, 1540) + "…";
  }
  const r1 = await notify("Brigham", text);
  const r2 = await notify("Karmel", "📋 Copy of the Friday schedule status text just sent to Brigham:\n\n" + text);
  try { await sheetAppend(REPORT_SHEET, "App Updates", [new Date().toISOString(), `📅 Friday schedule status texted to Brigham (copy Karmel): ${state}${r1.sent ? "" : " — TEXT FAILED: " + (r1.reason || "")}`, "Claude (Netlify scheduled)", "(log only)"]); } catch { /* log best-effort */ }
  console.log("friday-approval-nudge", state, r1, r2);
  return new Response(JSON.stringify({ ok: true, state, brigham: r1, karmel: r2 }), { headers: { "content-type": "application/json" } });
};
export const config = { schedule: "30 22,23 * * 5" };
