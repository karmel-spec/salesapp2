/**
 * ONE-TIME seed (Mark 11/16): handbook section 3 "Upright and Grand Refurbish",
 * Cleaning and Prep steps 6–15, as upright steps of the "Cabinetry Cleaning and
 * Prep" phase. Jacob's four-phase plan (092226mower21) carried only steps 1–5
 * (rows 202–206); Mark: "every piano needs the full cleaning steps, so it should
 * be part of the checklist". Written at the BOTTOM of the Phase Checklists tab so
 * no saved check-off moves; no column J — they display after steps 1–5, at the
 * end of the phase's list. Guarded and removed from the repo right after it has
 * run.   POST {key, dry?:true}
 */
import { googleToken, REPORT_SHEET, KEY } from "./_blp-sched-lib.mts";

const TAB = "Phase Checklists";
const PHASE = "Cabinetry Cleaning and Prep";
const ROWS: string[][] = [
 [
  "Cabinetry Cleaning and Prep",
  "work",
  "upright",
  "Cleaning",
  "Clean strings with Scotch Brite",
  "",
  "<p>6. Clean Strings with Scotch Brite</p>",
  "",
  "",
  ""
 ],
 [
  "Cabinetry Cleaning and Prep",
  "work",
  "upright",
  "Cleaning",
  "Clean capo bar or agraffes with Brite Boy",
  "",
  "<p>7. Clean Capo Bar or agraffes with Brite Boy</p>",
  "",
  "",
  ""
 ],
 [
  "Cabinetry Cleaning and Prep",
  "work",
  "upright",
  "Cleaning",
  "Clean and polish pedals with Brite Boy",
  "",
  "<p>8. Clean and polish pedals with Brite Boy</p>",
  "",
  "",
  ""
 ],
 [
  "Cabinetry Cleaning and Prep",
  "work",
  "upright",
  "Cleaning",
  "Vacuum keybed",
  "",
  "<p>9. Vacuum Keybed</p>",
  "",
  "",
  ""
 ],
 [
  "Cabinetry Cleaning and Prep",
  "work",
  "upright",
  "Cleaning",
  "Temporarily remove keys",
  "",
  "<p>10. Temporarily remove keys</p>",
  "",
  "",
  ""
 ],
 [
  "Cabinetry Cleaning and Prep",
  "work",
  "upright",
  "Cleaning",
  "Check if bushings need to be replaced",
  "",
  "<p>11. Check if bushings need to be replaced</p>",
  "",
  "",
  ""
 ],
 [
  "Cabinetry Cleaning and Prep",
  "work",
  "upright",
  "Cleaning",
  "Vacuum trapwork",
  "",
  "<p>12. Vacuum trapwork</p>",
  "",
  "",
  ""
 ],
 [
  "Cabinetry Cleaning and Prep",
  "work",
  "upright",
  "Cleaning",
  "Lubricate trapwork",
  "",
  "<p>13. Lubricate trapwork</p>",
  "",
  "",
  ""
 ],
 [
  "Cabinetry Cleaning and Prep",
  "work",
  "upright",
  "Cleaning",
  "Clean keys with Windex or TSP",
  "",
  "<p>14. Clean keys with windex or TSP</p>",
  "",
  "",
  ""
 ],
 [
  "Cabinetry Cleaning and Prep",
  "work",
  "upright",
  "Cleaning",
  "If not being refinished, clean the back with TSP (upright)",
  "",
  "<p>15. If not being refinished, clean the back with TSP (upright)</p>",
  "",
  "",
  ""
 ]
];

export default async (req: Request) => {
  const headers = { "content-type": "application/json", "cache-control": "no-store" };
  const out = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers });
  if (req.method !== "POST") return out({ error: "POST" }, 405);
  let b: Record<string, unknown> = {};
  try { b = JSON.parse(await req.text()); } catch { return out({ error: "bad json" }, 400); }
  if (String(b.key || "") !== KEY()) return out({ error: "unauthorized" }, 401);
  try {
    const tok = await googleToken();
    const api = `https://sheets.googleapis.com/v4/spreadsheets/${REPORT_SHEET}`;
    const auth = { Authorization: "Bearer " + tok, "Content-Type": "application/json" };
    const r = await fetch(`${api}/values/${encodeURIComponent(`'${TAB}'!A1:J600`)}`, { headers: auth });
    if (!r.ok) return out({ error: "read " + r.status }, 502);
    const v = ((await r.json()) as { values?: string[][] }).values || [];
    const cell = (row: number, col: number) => String((v[row - 1] || [])[col] || "").trim();
    const last = v.length;
    const problems: string[] = [];
    if (v.some((x) => String(x[0] || "").trim() === PHASE && ROWS.some((n) => String(x[4] || "").trim() === n[4]))) problems.push("already seeded");
    if (cell(1, 0) !== "Phase") problems.push("row 1 is not the header");
    if (last !== 249) problems.push("expected the tab to end at row 249, it ends at " + last);
    if (cell(249, 0) !== "CAP" || cell(249, 1) !== "qc" || cell(249, 4).indexOf("New whippens") !== 0) problems.push("row 249 is not the grand action prep mini-QC line");
    for (let n = 202; n <= 206; n++) if (cell(n, 0) !== PHASE || cell(n, 1) !== "work" || cell(n, 2) !== "upright") problems.push("row " + n + " is not an upright " + PHASE + " step");
    if (v.filter((x) => String(x[0] || "").trim() === PHASE).length !== 5) problems.push("the phase does not have exactly 5 rows today");
    const first = last + 1, lastNew = last + ROWS.length;
    if (problems.length || b.dry) return out({ ok: !problems.length, dry: true, problems, lastRow: last, wouldWriteRows: [first, lastNew], count: ROWS.length });
    const put = () => fetch(`${api}/values:batchUpdate`, { method: "POST", headers: auth, body: JSON.stringify({
      valueInputOption: "RAW", data: [{ range: `'${TAB}'!A${first}:J${lastNew}`, values: ROWS }] }) });
    let w = await put(), txt = w.ok ? "" : await w.text();
    if (!w.ok && /exceeds grid limits/i.test(txt)) {
      const meta = await (await fetch(`${api}?fields=sheets.properties`, { headers: auth })).json() as { sheets: Array<{ properties: { title: string; sheetId: number } }> };
      const sid = (meta.sheets.find((s) => s.properties.title === TAB) || { properties: { sheetId: -1 } }).properties.sheetId;
      if (sid < 0) return out({ error: "tab not found" }, 502);
      const g = await fetch(`${api}:batchUpdate`, { method: "POST", headers: auth, body: JSON.stringify({ requests: [{ appendDimension: { sheetId: sid, dimension: "ROWS", length: 30 } }] }) });
      if (!g.ok) return out({ error: "grow " + g.status }, 502);
      w = await put(); txt = w.ok ? "" : await w.text();
    }
    return out({ ok: w.ok, wroteRows: w.ok ? [first, lastNew] : null, error: w.ok ? undefined : txt.slice(0, 200) }, w.ok ? 200 : 502);
  } catch (e) {
    return out({ error: String((e as Error).message || e).slice(0, 200) }, 500);
  }
};

export const config = { path: "/.netlify/functions/checklist-seed-refurb-cleaning" };
