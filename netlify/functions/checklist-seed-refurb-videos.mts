/**
 * ONE-TIME (Mark 11/18): handbook training videos on the refurbish checklist
 * steps — column H "Video" (ytId@start|Title, ;; between several) of the
 * Phase Checklists tab, same format as the CAP / PRSB rows. Each row is
 * written only if it still holds the expected phase + step and its Video cell
 * is EMPTY (techs' own 🎬 clips land in the same column). Guarded; removed
 * from the repo right after it has run.   POST {key, dry?:true}
 */
import { googleToken, REPORT_SHEET, KEY } from "./_blp-sched-lib.mts";

const TAB = "Phase Checklists";
const ITEMS: Array<[number, string, string, string]> = [
 [
  210,
  "Action Problems and Hammer Prep",
  "Reshape Hammers",
  "-eKvSEGGsZo@0|Upright hammer reshaping"
 ],
 [
  223,
  "Action Lubrication and Alignment",
  "Align hammers to strings",
  "dpCf_ATfxDM@188|Upright Hammer Alignment"
 ],
 [
  224,
  "Regulation",
  "Square, space and level keys",
  "uou0M_W9OJw@1|Upright Regulation Theory;;qIKca27rVQ0@0|Key Leveling"
 ],
 [
  225,
  "Regulation",
  "Choosing rest rail height",
  "F6QyuY9HaRo@9|Choosing Rest Rail Height"
 ],
 [
  226,
  "Regulation",
  "Regulate all lost motion",
  "KfxKyqUrl8k@0|Tricks for Lost Motion Regulating"
 ],
 [
  227,
  "Regulation",
  "Regulate let off",
  "2Ww35DGd2bw@19|Tricks for Let Off Regulation"
 ],
 [
  228,
  "Regulation",
  "Align backchecks",
  "RYrvzx4f8t4@0|Aligning Backchecks"
 ],
 [
  230,
  "Regulation",
  "Damper lift regulation",
  "9xAn4u6RzlA@1|Damper Lift"
 ],
 [
  231,
  "Regulation",
  "Damper spoon regulation",
  "eTvxjx1yy2E@1|Damper Spoon Regulation"
 ],
 [
  279,
  "Regulation",
  "Bedding",
  "ff37ciHxhkc@2|Grand Piano Regulation Theory"
 ],
 [
  283,
  "Regulation",
  "Set dip by the dip block",
  "GJgrz7dp3Is@0|Spring Strength, Drop, and Dip"
 ],
 [
  286,
  "Regulation",
  "Set drop according to let-off",
  "GJgrz7dp3Is@0|Spring Strength, Drop, and Dip"
 ],
 [
  290,
  "Regulation",
  "Set spring strength and checking",
  "GJgrz7dp3Is@0|Spring Strength, Drop, and Dip"
 ],
 [
  295,
  "Regulation",
  "Drop",
  "GJgrz7dp3Is@0|Spring Strength, Drop, and Dip"
 ],
 [
  296,
  "Regulation",
  "Spring strength",
  "GJgrz7dp3Is@0|Spring Strength, Drop, and Dip"
 ],
 [
  300,
  "Regulation",
  "Set dip by 0.020",
  "GJgrz7dp3Is@0|Spring Strength, Drop, and Dip"
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
    const problems: string[] = [];
    if (v.length !== 300) problems.push("expected the tab to end at row 300, it ends at " + v.length);
    for (const [row, phase, starts] of ITEMS) {
      if (cell(row, 0) !== phase) problems.push("row " + row + " phase is " + cell(row, 0));
      if (cell(row, 4).toLowerCase().indexOf(starts.toLowerCase()) !== 0) problems.push("row " + row + " step is " + cell(row, 4).slice(0, 40));
      if (cell(row, 7)) problems.push("row " + row + " already has a video: " + cell(row, 7).slice(0, 40));
    }
    if (problems.length || b.dry) return out({ ok: !problems.length, dry: true, problems, count: ITEMS.length });
    const data = ITEMS.map(([row, , , video]) => ({ range: `'${TAB}'!H${row}`, values: [[video]] }));
    const w = await fetch(`${api}/values:batchUpdate`, { method: "POST", headers: auth, body: JSON.stringify({ valueInputOption: "RAW", data }) });
    return out({ ok: w.ok, wrote: w.ok ? ITEMS.length : 0, error: w.ok ? undefined : (await w.text()).slice(0, 200) }, w.ok ? 200 : 502);
  } catch (e) {
    return out({ error: String((e as Error).message || e).slice(0, 200) }, 500);
  }
};

export const config = { path: "/.netlify/functions/checklist-seed-refurb-videos" };
