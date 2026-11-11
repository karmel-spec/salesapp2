/**
 * Punch timing log (Mark 11/11, after Alex's 48 s clock-in — 111026martin06).
 * Every day / piano clock punch the Store Map makes reports how long it took
 * on the phone, how long Google's part was, how many tries it needed and how
 * it ended. One row per punch in the reports spreadsheet's "Punch Timing" tab
 * (created on first use), so slow punches are numbers, not impressions.
 *
 *   POST (text/plain JSON — no CORS preflight; the app sends and forgets)
 *        {key, who, clock: day|piano, action, ms, googleMs, tries, outcome,
 *         device, net, source, app, at}
 *   GET  ?key&days=14 → {ok, rows: [{at, who, clock, action, secs, googleSecs, tries, outcome, device, net, source, app}]}
 *
 * Nothing here touches the bridge, the payroll tabs or Supabase.
 */
import { googleToken, REPORT_SHEET } from "./_blp-sched-lib.mts";

const TAB = "Punch Timing";
const HEADER = ["Logged (server)", "Punch at", "Who", "Clock", "Action", "Seconds total", "Google seconds",
  "Tries", "Outcome", "Device", "Network", "Source", "App version"];
const ALLOW = ["https://blpstoremap.netlify.app", "http://localhost:8641"];

const s = (v: unknown, n = 80) => String(v ?? "").replace(/[\r\n\t]+/g, " ").trim().slice(0, n);
const num = (v: unknown) => { const x = Number(v); return isFinite(x) && x >= 0 && x < 3600000 ? x : null; };

async function ensureTab(tok: string) {
  // add the tab + header row once; "already exists" is the normal answer after that
  const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${REPORT_SHEET}:batchUpdate`, {
    method: "POST", headers: { Authorization: "Bearer " + tok, "Content-Type": "application/json" },
    body: JSON.stringify({ requests: [{ addSheet: { properties: { title: TAB, gridProperties: { frozenRowCount: 1 } } } }] }) });
  if (r.ok) await append(tok, HEADER);
}
async function append(tok: string, row: unknown[]) {
  return fetch(`https://sheets.googleapis.com/v4/spreadsheets/${REPORT_SHEET}/values/${encodeURIComponent(`'${TAB}'!A1`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    { method: "POST", headers: { Authorization: "Bearer " + tok, "Content-Type": "application/json" }, body: JSON.stringify({ values: [row] }) });
}

export default async (req: Request) => {
  const origin = req.headers.get("origin");
  const headers = { "access-control-allow-origin": origin && ALLOW.includes(origin) ? origin : ALLOW[0],
    "access-control-allow-headers": "content-type", "content-type": "application/json", "cache-control": "no-store" };
  if (req.method === "OPTIONS") return new Response("", { headers });
  const KEY = process.env.BLP_APP_ACCESS_KEY || "pianoman";
  try {
    if (req.method === "GET") {
      const u = new URL(req.url);
      if ((u.searchParams.get("key") || "") !== KEY) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers });
      const days = Math.min(120, Number(u.searchParams.get("days")) || 14);
      const cut = Date.now() - days * 86400000;
      const tok = await googleToken();
      const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${REPORT_SHEET}/values/${encodeURIComponent(`'${TAB}'!A2:M20000`)}`,
        { headers: { Authorization: "Bearer " + tok } });
      if (!r.ok) return new Response(JSON.stringify({ ok: true, rows: [], note: "no Punch Timing tab yet" }), { headers });
      const vals = ((await r.json()) as { values?: string[][] }).values || [];
      // "Claude test" rows are the deploy check's own (11/11) — never real punches
      const rows = vals.filter(v => new Date(v[1] || v[0]).getTime() >= cut && !/^claude test/i.test(String(v[2] || ""))).map(v => ({
        at: v[1] || v[0], who: v[2], clock: v[3], action: v[4], secs: Number(v[5]) || 0, googleSecs: v[6] === "" ? null : Number(v[6]),
        tries: Number(v[7]) || 0, outcome: v[8], device: v[9], net: v[10], source: v[11], app: v[12] }));
      return new Response(JSON.stringify({ ok: true, rows }), { headers });
    }
    if (req.method !== "POST") return new Response(JSON.stringify({ error: "POST or GET" }), { status: 405, headers });
    let b: Record<string, unknown> = {};
    try { b = JSON.parse(await req.text()); } catch { return new Response(JSON.stringify({ error: "bad json" }), { status: 400, headers }); }
    if (s(b.key) !== KEY) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers });
    const ms = num(b.ms);
    if (ms == null || !s(b.who)) return new Response(JSON.stringify({ error: "who and ms required" }), { status: 400, headers });
    const g = num(b.googleMs);
    const at = new Date(s(b.at, 40));
    const row = [new Date().toISOString(), isNaN(at.getTime()) ? new Date().toISOString() : at.toISOString(),
      s(b.who, 60), s(b.clock, 10), s(b.action, 20), Math.round(ms / 100) / 10, g == null ? "" : Math.round(g / 100) / 10,
      Math.min(9, Number(b.tries) || 0), s(b.outcome, 140), s(b.device, 10), s(b.net, 10), s(b.source, 30), s(b.app, 10)];
    const tok = await googleToken();
    let r = await append(tok, row);
    if (!r.ok) {
      const txt = await r.text();
      if (/Unable to parse range|not found/i.test(txt)) { await ensureTab(tok); r = await append(tok, row); }
    }
    return new Response(JSON.stringify({ ok: r.ok }), { status: r.ok ? 200 : 502, headers });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error).message || e).slice(0, 200) }), { status: 500, headers });
  }
};

export const config = { path: "/.netlify/functions/punch-timing" };
