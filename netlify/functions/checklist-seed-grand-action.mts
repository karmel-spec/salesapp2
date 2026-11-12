/**
 * ONE-TIME seed (Hunter 111226rawlings15, Mark 11/12): handbook 2a "Grand Action
 * Prep — FULL REBUILD LEVEL" as grand CAP steps (13 work + 2 mini-QC lines), the
 * grand counterpart of the upright 1a rows 125–143. Written at the BOTTOM of the
 * Phase Checklists tab so no saved check-off moves; no column J, so they display
 * at the end of the grand list like the upright action prep. Guarded and removed
 * from the repo right after it has run.   POST {key, dry?:true}
 */
import { googleToken, REPORT_SHEET, KEY } from "./_blp-sched-lib.mts";

const TAB = "Phase Checklists";
const ROWS: string[][] = [
 [
  "CAP",
  "work",
  "grand",
  "Action prep",
  "Cut off damper felts — damper info written down first",
  "Damper info = step 4 in Grand Cleaning & Prep (the Dampers step). Leather glove on the left hand, hold the damper head, fresh blade in the blade holder.",
  "<p><b>2a. Grand Action Prep — FULL REBUILD LEVEL</b></p><p>1. Cut off damper felts. Make sure you&#x27;ve already written down damper info explained on step 4 in Grand Cleaning &amp; Prep.</p><p>2. Wear leather glove on left hand. Hold damper head in left hand and cut with fresh blade in blade holder.</p>",
  "",
  "",
  ""
 ],
 [
  "CAP",
  "work",
  "grand",
  "Action prep",
  "Sodablast the action stack",
  "Make needed repairs at an appropriate time.",
  "<p>3. Sodablast action stack.</p><p><i>*Make needed repairs at an appropriate time.</i></p>",
  "",
  "",
  ""
 ],
 [
  "CAP",
  "work",
  "grand",
  "Action prep",
  "Remove rest rail & let-off button rail",
  "",
  "<p>1. Remove rest rail and let off button rail.</p>",
  "",
  "",
  ""
 ],
 [
  "CAP",
  "work",
  "grand",
  "Action prep",
  "Number & remove hammers — section ends separate",
  "",
  "<p>2. Number and remove hammers. Keep section ends separate.</p>",
  "",
  "",
  ""
 ],
 [
  "CAP",
  "work",
  "grand",
  "Action prep",
  "Remove whippens",
  "",
  "<p>3. Remove whippens.</p>",
  "",
  "",
  ""
 ],
 [
  "CAP",
  "work",
  "grand",
  "Action prep",
  "Tighten all screws while the hammers are out",
  "",
  "<p>4. Tighten all screws while the hammers are still out.</p>",
  "",
  "",
  ""
 ],
 [
  "CAP",
  "work",
  "grand",
  "Action prep",
  "Recover the rest rail — new cloth, burn frizzies",
  "Remove the old cloth first.",
  "<p>5. Remove the old cloth from the rest rail. Install new rest rail cloth and burn frizzies.</p>",
  "",
  "",
  ""
 ],
 [
  "CAP",
  "work",
  "grand",
  "Action prep",
  "Install new whippens — glue heels first if separate",
  "Once the new hammers, flanges and whippens arrive. Whippen heels that come separately: glue them on first, using an old sample as the guide for location.",
  "<p>6. Once new hammers and flanges and whippens arrive, install.</p><p>7. If whippen heels come separately, glue those on first using an old sample as a guide for location.</p><p>8. Install whippens.</p>",
  "",
  "",
  ""
 ],
 [
  "CAP",
  "work",
  "grand",
  "Action prep",
  "Install hammer shanks & flanges",
  "",
  "<p>9. Install hammer shanks and flanges.</p>",
  "",
  "",
  ""
 ],
 [
  "CAP",
  "work",
  "grand",
  "Action prep",
  "Replace let-off buttons & eye-screws",
  "",
  "<p>10. Replace let off buttons and let off eye-screws.</p>",
  "",
  "",
  ""
 ],
 [
  "CAP",
  "work",
  "grand",
  "Action prep",
  "Let-off rail back in the action",
  "",
  "<p>11. Put let off rail back in the action.</p>",
  "",
  "",
  ""
 ],
 [
  "CAP",
  "work",
  "grand",
  "Action prep",
  "Lubricate action",
  "",
  "<p>12. Lubricate action.</p>",
  "",
  "",
  ""
 ],
 [
  "CAP",
  "work",
  "grand",
  "Action prep",
  "Action back on the shelf",
  "",
  "<p>13. Put action back on shelf.</p>",
  "",
  "",
  ""
 ],
 [
  "CAP",
  "qc",
  "grand",
  "Action prep",
  "Dampers off, action stack sodablasted, screws tight, rest rail recovered (new cloth, frizzies burned)",
  "",
  "",
  "",
  "",
  ""
 ],
 [
  "CAP",
  "qc",
  "grand",
  "Action prep",
  "New whippens, hammer shanks & flanges installed; let-off buttons & eye-screws replaced, let-off rail back in; action lubricated and back on the shelf",
  "",
  "",
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
    if (v.some((x) => ROWS.some((n) => String(x[4] || "").trim() === n[4]))) problems.push("already seeded");
    if (cell(1, 0) !== "Phase") problems.push("row 1 is not the header");
    if (last !== 234) problems.push("expected the tab to end at row 234, it ends at " + last);
    if (cell(234, 0) !== "CAP" || cell(234, 1) !== "qc" || cell(234, 4).indexOf("Downbearing readings") !== 0) problems.push("row 234 is not the downbearing mini-QC line");
    if (cell(125, 2) !== "upright" || cell(125, 3) !== "Action prep") problems.push("row 125 is not the upright action prep start");
    if (cell(36, 0) !== "CAP" || cell(36, 2) !== "grand" || cell(36, 3) !== "Wrap-up") problems.push("row 36 is not the grand CAP wrap-up");
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

export const config = { path: "/.netlify/functions/checklist-seed-grand-action" };
