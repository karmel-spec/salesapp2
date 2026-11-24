/**
 * ONE-TIME seed (Mark 11/24): "Measure and take pictures of any decals" as a
 * CAP step right after plate removal (upright after row 15, grand after row
 * 29 — before the soundboard is blown out / cleaned) and as a CAP mini-QC
 * line after the Records line (row 37). Written at the BOTTOM of the Phase
 * Checklists tab so no saved check-off moves; column J places them on screen.
 * Guarded (expected neighbours, not already there) and removed from the repo
 * right after it has run.
 *   POST {key, dry?:true}
 */
import { googleToken, REPORT_SHEET, KEY } from "./_blp-sched-lib.mts";

const TAB = "Phase Checklists";
const STEP = "Measure and take pictures of any decals";
const CAUTION = "Three pictures of every decal: one with a ruler showing the width, one with a ruler showing the height, and one with no ruler.";
const HANDBOOK = "<p>Before the soundboard is blown out or cleaned, find every decal on the piano (soundboard, fallboard or anywhere else) and measure it. Take three pictures of each decal: one with a ruler showing the width, one with a ruler showing the height, and one with no ruler. Upload them to the tech folder in the piano\u2019s Google Drive folder so a new decal can be ordered.</p>";
const QC = "Every decal has 3 pictures in the piano's Drive folder: ruler on the width, ruler on the height, and one with no ruler";

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
    const r = await fetch(`${api}/values/${encodeURIComponent(`'${TAB}'!A1:J800`)}`, { headers: auth });
    if (!r.ok) return out({ error: "read " + r.status }, 502);
    const v = ((await r.json()) as { values?: string[][] }).values || [];
    const cell = (row: number, col: number) => String((v[row - 1] || [])[col] || "").trim();
    const last = v.length;   // trailing blank rows are not returned
    const problems: string[] = [];
    if (v.some((x) => String(x[4] || "").trim() === STEP || String(x[4] || "").trim() === QC)) problems.push("already seeded");
    if (cell(1, 0) !== "Phase") problems.push("row 1 is not the header");
    if (cell(15, 0) !== "CAP" || cell(15, 2) !== "upright" || cell(15, 4).indexOf("Remove plate") !== 0) problems.push("row 15 is not upright CAP 'Remove plate'");
    if (cell(29, 0) !== "CAP" || cell(29, 2) !== "grand" || cell(29, 4).indexOf("Remove plate") !== 0) problems.push("row 29 is not grand CAP 'Remove plate'");
    if (cell(37, 0) !== "CAP" || cell(37, 1) !== "qc" || cell(37, 4).indexOf("BEFORE pics") !== 0) problems.push("row 37 is not the CAP qc Records line");
    if (last !== 300) problems.push("tab ends at row " + last + ", expected 300");
    const first = last + 1;
    const rows = [
      ["CAP", "work", "upright", "Decals", STEP, CAUTION, HANDBOOK, "", "", "15"],
      ["CAP", "work", "grand", "Decals", STEP, CAUTION, HANDBOOK, "", "", "29"],
      ["CAP", "qc", "all", "Decals", QC, "", "", "", "", "37"],
    ];
    if (problems.length || b.dry) return out({ ok: !problems.length, dry: true, problems, lastRow: last, wouldWriteRows: [first, first + 2], rows });
    const put = () => fetch(`${api}/values:batchUpdate`, { method: "POST", headers: auth, body: JSON.stringify({
      valueInputOption: "RAW", data: [{ range: `'${TAB}'!A${first}:J${first + 2}`, values: rows }] }) });
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

export const config = { path: "/.netlify/functions/checklist-seed-decals" };
