/**
 * ⚙️ App Settings feed (Brigham 9/4): serves the Settings/Roles/Assignments
 * tabs to the client (settings page, permission gates, weekly caps) and to
 * sibling functions. Cached 3 minutes. GET ?key=pianoman
 */
import * as crypto from "node:crypto";
const SHEET_ID = "11RoeVRETag5rZYX6_tEH-rf6x8JL0JeZU0P5AT0WI-I";
const ALLOW = ["https://blpstoremap.netlify.app", "http://localhost:8641"];

let tokenCache: { token: string; exp: number } | null = null;
async function googleToken(): Promise<string> {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || "";
  const key = (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
  const now = Math.floor(Date.now() / 1000);
  if (tokenCache && tokenCache.exp > now + 60) return tokenCache.token;
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const header = b64({ alg: "RS256", typ: "JWT" });
  const claims = b64({ iss: email, scope: "https://www.googleapis.com/auth/spreadsheets.readonly",
    aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 });
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  const sig = signer.sign(key).toString("base64url");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${header}.${claims}.${sig}` }) });
  const j = (await res.json()) as { access_token: string; expires_in: number };
  tokenCache = { token: j.access_token, exp: now + j.expires_in };
  return j.access_token;
}

let cache: { at: number; body: string } | null = null;
export async function loadSettings(): Promise<{ settings: Record<string, string>; roles: Record<string, string>; assignments: Array<Record<string, string>> }> {
  if (cache && Date.now() - cache.at < 180000) return JSON.parse(cache.body);
  const t = await googleToken();
  const ranges = ["'App Settings'!A2:B100", "'Roles'!A2:B30", "'Role Assignments'!A2:E100"];
  const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values:batchGet?` +
    ranges.map(x => "ranges=" + encodeURIComponent(x)).join("&"),
    { headers: { Authorization: "Bearer " + t } });
  const d = (await r.json()) as { valueRanges: Array<{ values?: string[][] }> };
  const settings: Record<string, string> = {};
  (d.valueRanges[0]?.values || []).forEach(v => { if (v[0]) settings[String(v[0]).trim()] = String(v[1] ?? "").trim(); });
  const roles: Record<string, string> = {};
  (d.valueRanges[1]?.values || []).forEach(v => { if (v[0]) roles[String(v[0]).trim().toLowerCase()] = String(v[1] ?? ""); });
  const assignments = (d.valueRanges[2]?.values || []).filter(v => v[0]).map(v => ({
    email: String(v[0]).trim().toLowerCase(), name: String(v[1] || ""), role: String(v[2] || "").trim().toLowerCase(),
    plus: String(v[3] || ""), minus: String(v[4] || "") }));
  const out = { settings, roles, assignments };
  cache = { at: Date.now(), body: JSON.stringify(out) };
  return out;
}

export default async (req: Request) => {
  const origin = req.headers.get("origin");
  const headers = { "access-control-allow-origin": origin && ALLOW.includes(origin) ? origin : ALLOW[0],
    "content-type": "application/json" };
  const u = new URL(req.url);
  if ((u.searchParams.get("key") || "") !== (process.env.BLP_APP_ACCESS_KEY || "pianoman")) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers });
  }
  try { return new Response(JSON.stringify({ ok: true, ...(await loadSettings()) }), { headers }); }
  catch (e) { return new Response(JSON.stringify({ error: String((e as Error).message || e) }), { status: 502, headers }); }
};
