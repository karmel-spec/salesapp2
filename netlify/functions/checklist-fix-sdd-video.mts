/**
 * ONE-TIME (Mark 11/18): the "Spring Strength, Drop, and Dip" video belongs on
 * the grand Regulation step "Confirm plenty of dip, drop and spring strength"
 * (Phase Checklists row 282), not on the six separate dip / drop / spring
 * steps (rows 283, 286, 290, 295, 296, 300). Guarded: each cell must still
 * hold exactly what this expects. Removed from the repo after it has run.
 *   POST {key, dry?:true}
 */
import { googleToken, REPORT_SHEET, KEY } from "./_blp-sched-lib.mts";

const TAB = "Phase Checklists";
const SDD = "GJgrz7dp3Is@0|Spring Strength, Drop, and Dip";
const CLEAR = [283, 286, 290, 295, 296, 300];

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
    if (cell(282, 0) !== "Regulation" || cell(282, 2).toLowerCase() !== "grand" || cell(282, 4).indexOf("Confirm plenty of dip") !== 0) problems.push("row 282 is not the grand 'Confirm plenty of dip…' step");
    if (cell(282, 7)) problems.push("row 282 already has a video: " + cell(282, 7).slice(0, 40));
    for (const n of CLEAR) if (cell(n, 7) !== SDD) problems.push("row " + n + " video is not the expected one: " + (cell(n, 7) || "(blank)").slice(0, 40));
    if (problems.length || b.dry) return out({ ok: !problems.length, dry: true, problems });
    const data = [{ range: `'${TAB}'!H282`, values: [[SDD]] }].concat(CLEAR.map((n) => ({ range: `'${TAB}'!H${n}`, values: [[""]] })));
    const w = await fetch(`${api}/values:batchUpdate`, { method: "POST", headers: auth, body: JSON.stringify({ valueInputOption: "RAW", data }) });
    return out({ ok: w.ok, moved: w.ok, error: w.ok ? undefined : (await w.text()).slice(0, 200) }, w.ok ? 200 : 502);
  } catch (e) {
    return out({ error: String((e as Error).message || e).slice(0, 200) }, 500);
  }
};

export const config = { path: "/.netlify/functions/checklist-fix-sdd-video" };
