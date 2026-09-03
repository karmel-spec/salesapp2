/**
 * FAST personal clock feed (Brigham 9/3): payroll punches + piano sessions
 * straight from the sheets via the service account (~0.5s), so every team
 * member can verify their own clock-ins even when Apps Script is slow.
 * GET ?key&days=16 → {ok, pay:[{tech,start,end,minutes}], tl:[{tech,serial,piano,phase,start,end,minutes}]}
 */
import * as crypto from "node:crypto";
const SHEET_ID = "11RoeVRETag5rZYX6_tEH-rf6x8JL0JeZU0P5AT0WI-I";
const ALLOW = ["https://blpstoremap.netlify.app", "http://localhost:8641"];
let tok: { t: string; e: number } | null = null;
async function gt(): Promise<string> {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || "";
  const key = (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
  const now = Math.floor(Date.now() / 1000);
  if (tok && tok.e > now + 60) return tok.t;
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const hd = b64({ alg: "RS256", typ: "JWT" });
  const cl = b64({ iss: email, scope: "https://www.googleapis.com/auth/spreadsheets.readonly",
    aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 });
  const sg = crypto.createSign("RSA-SHA256"); sg.update(`${hd}.${cl}`);
  const sig = sg.sign(key).toString("base64url");
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${hd}.${cl}.${sig}` }) });
  const j = (await r.json()) as { access_token: string; expires_in: number };
  tok = { t: j.access_token, e: now + j.expires_in };
  return j.access_token;
}
export default async (req: Request) => {
  const origin = req.headers.get("origin");
  const headers = { "access-control-allow-origin": origin && ALLOW.includes(origin) ? origin : ALLOW[0],
    "access-control-allow-headers": "content-type", "content-type": "application/json", "cache-control": "no-store" };
  if (req.method === "OPTIONS") return new Response("", { headers });
  const u = new URL(req.url);
  if ((u.searchParams.get("key") || "") !== (process.env.BLP_APP_ACCESS_KEY || "")) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers });
  }
  const days = Math.min(60, Number(u.searchParams.get("days")) || 16);
  const cutoff = Date.now() - days * 86400000;
  try {
    const t = await gt();
    const ranges = ["Payroll Clock!A2:G4000", "Time Log!A2:H8000"];
    const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values:batchGet?` +
      ranges.map((x) => "ranges=" + encodeURIComponent(x)).join("&"),
      { headers: { Authorization: "Bearer " + t } });
    if (!r.ok) throw new Error("sheets " + r.status);
    const d = (await r.json()) as { valueRanges: Array<{ values?: string[][] }> };
    const okd = (v: string) => { const x = new Date(v).getTime(); return !isNaN(x) && x >= cutoff; };
    // payroll day-clock officially began 9/1/2026 (Brigham 9/3) — earlier
    // day punches were trial rows and never show on dashboards. Piano
    // Time Log history has no epoch: it's all real work.
    const PAY_EPOCH = new Date("2026-09-01T00:00:00-06:00").getTime();
    const okPay = (v: string) => { const x = new Date(v).getTime(); return !isNaN(x) && x >= Math.max(cutoff, PAY_EPOCH); };
    const pay = (d.valueRanges[0]?.values || [])
      .filter((v) => v[0] && v[2] && okPay(v[2]))
      .map((v) => ({ tech: String(v[0]), start: String(v[2]), end: String(v[3] || ""), minutes: Number(v[4]) || 0, note: String(v[6] || "") }));
    const tl = (d.valueRanges[1]?.values || [])
      .filter((v) => v[0] && v[4] && okd(v[4]))
      .map((v) => ({ tech: String(v[0]), serial: String(v[1] || ""), piano: String(v[2] || ""), phase: String(v[3] || ""),
        start: String(v[4]), end: String(v[5] || ""), minutes: Number(v[6]) || 0 }));
    return new Response(JSON.stringify({ ok: true, pay, tl }), { headers });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error).message || e) }), { status: 502, headers });
  }
};
