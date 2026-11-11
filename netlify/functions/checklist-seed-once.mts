/**
 * ONE-TIME seed (Hunter 111026rawlings14, Mark 11/11): the CAP downbearing
 * check before the plate comes out — two work steps (upright, grand) and one
 * mini-QC line, written at the BOTTOM of the Phase Checklists tab so no saved
 * check-off moves, with column J "Show after row #" placing them on screen.
 * Guarded (expected neighbours, empty target rows, not already there) and
 * removed from the repo right after it has run.
 *   POST {key, dry?:true}
 */
import { googleToken, REPORT_SHEET, KEY } from "./_blp-sched-lib.mts";

const TAB = "Phase Checklists";
const STEP = "Check downbearing and record on the teardown sheet BEFORE removing the plate";
const QC = "Downbearing readings recorded before plate removal";
const J_HEADER = "Show after row # (optional — new steps go at the BOTTOM of the tab; this is where they display)";

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
    const last = v.length;   // trailing blank rows are not returned
    const problems: string[] = [];
    if (v.some((x) => String(x[4] || "").trim() === STEP || String(x[4] || "").trim() === QC)) problems.push("already seeded");
    if (cell(1, 0) !== "Phase") problems.push("row 1 is not the header");
    if (cell(14, 0) !== "CAP" || cell(14, 2) !== "upright" || cell(14, 4) !== "Remove tuning pins") problems.push("row 14 is not upright 'Remove tuning pins'");
    if (cell(15, 4).indexOf("Remove plate") !== 0) problems.push("row 15 is not upright 'Remove plate'");
    if (cell(28, 0) !== "CAP" || cell(28, 2) !== "grand" || cell(28, 4) !== "Remove agraffes") problems.push("row 28 is not grand 'Remove agraffes'");
    if (cell(29, 4).indexOf("Remove plate") !== 0) problems.push("row 29 is not grand 'Remove plate'");
    if (cell(40, 0) !== "CAP" || cell(40, 1) !== "qc" || cell(40, 4).indexOf("Hellerbass") !== 0) problems.push("row 40 is not the CAP qc Hellerbass line");
    if (cell(1, 9) && cell(1, 9) !== J_HEADER) problems.push("J1 already holds: " + cell(1, 9).slice(0, 40));
    if (v.some((x, n) => n > 0 && String(x[9] || "").trim())) problems.push("column J already has values");
    const first = last + 1;
    const rows = [
      ["CAP", "work", "upright", "Plate", STEP, "", "", "", "", "14"],
      ["CAP", "work", "grand", "Plate", STEP, "", "", "", "", "28"],
      ["CAP", "qc", "all", "Downbearing", QC, "", "", "", "", "40"],
    ];
    if (problems.length || b.dry) return out({ ok: !problems.length, dry: true, problems, lastRow: last, wouldWriteRows: [first, first + 2], rows });
    const put = () => fetch(`${api}/values:batchUpdate`, { method: "POST", headers: auth, body: JSON.stringify({
      valueInputOption: "RAW", data: [
        { range: `'${TAB}'!J1`, values: [[J_HEADER]] },
        { range: `'${TAB}'!A${first}:J${first + 2}`, values: rows },
      ] }) });
    let w = await put(), txt = w.ok ? "" : await w.text();
    if (!w.ok && /exceeds grid limits/i.test(txt)) {   // the tab's grid ends at its last row — add room, then write
      const meta = await (await fetch(`${api}?fields=sheets.properties`, { headers: auth })).json() as { sheets: Array<{ properties: { title: string; sheetId: number } }> };
      const sid = (meta.sheets.find((s) => s.properties.title === TAB) || { properties: { sheetId: -1 } }).properties.sheetId;
      if (sid < 0) return out({ error: "tab not found" }, 502);
      const g = await fetch(`${api}:batchUpdate`, { method: "POST", headers: auth, body: JSON.stringify({ requests: [{ appendDimension: { sheetId: sid, dimension: "ROWS", length: 20 } }] }) });
      if (!g.ok) return out({ error: "grow " + g.status }, 502);
      w = await put(); txt = w.ok ? "" : await w.text();
    }
    return out({ ok: w.ok, wroteRows: w.ok ? [first, first + 2] : null, error: w.ok ? undefined : txt.slice(0, 200) }, w.ok ? 200 : 502);
  } catch (e) {
    return out({ error: String((e as Error).message || e).slice(0, 200) }, 500);
  }
};

export const config = { path: "/.netlify/functions/checklist-seed-once" };
