/**
 * ONE-TIME (Mark 11/24): Lisa Litton left BLP — remove her two App Settings
 * rows, week_cap_lisa and flat_finish_lisa. Settings are read by key, so
 * deleting the rows moves nothing that matters. Guarded (finds each row by its
 * key at run time, refuses if either is missing or duplicated), dry run first,
 * removed from the repo right after it has run.
 *   POST {key, dry?:true}
 */
import { googleToken, REPORT_SHEET, KEY } from "./_blp-sched-lib.mts";

const TAB = "App Settings";
const KEYS = ["week_cap_lisa", "flat_finish_lisa"];

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
    const r = await fetch(`${api}/values/${encodeURIComponent(`'${TAB}'!A1:C200`)}`, { headers: auth });
    if (!r.ok) return out({ error: "read " + r.status }, 502);
    const v = ((await r.json()) as { values?: string[][] }).values || [];
    const rows: { key: string; row: number; value: string }[] = [];
    const problems: string[] = [];
    for (const k of KEYS) {
      const hits = v.map((x, i) => ({ x, i })).filter(({ x }) => String(x[0] || "").trim() === k);
      if (hits.length !== 1) problems.push(`${k}: ${hits.length} rows`);
      else rows.push({ key: k, row: hits[0].i + 1, value: String(hits[0].x[1] || "") });
    }
    if (problems.length || b.dry) return out({ ok: !problems.length, dry: true, problems, rows });
    const meta = await (await fetch(`${api}?fields=sheets.properties`, { headers: auth })).json() as { sheets: Array<{ properties: { title: string; sheetId: number } }> };
    const sid = (meta.sheets.find((s) => s.properties.title === TAB) || { properties: { sheetId: -1 } }).properties.sheetId;
    if (sid < 0) return out({ error: "tab not found" }, 502);
    const requests = rows.slice().sort((a, c) => c.row - a.row)
      .map((x) => ({ deleteDimension: { range: { sheetId: sid, dimension: "ROWS", startIndex: x.row - 1, endIndex: x.row } } }));
    const w = await fetch(`${api}:batchUpdate`, { method: "POST", headers: auth, body: JSON.stringify({ requests }) });
    return out({ ok: w.ok, deleted: w.ok ? rows : null, error: w.ok ? undefined : (await w.text()).slice(0, 200) }, w.ok ? 200 : 502);
  } catch (e) {
    return out({ error: String((e as Error).message || e).slice(0, 200) }, 500);
  }
};

export const config = { path: "/.netlify/functions/onetime-settings-lisa" };
