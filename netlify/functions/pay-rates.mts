/**
 * Loaded pay rates for Shop Board job costing — reads the "Pay Rates" tab of
 * the report sheet (Name | Loaded $/h | Notes). Rates are entered by Brigham /
 * Karmel; anyone blank falls back to the blended rate typed in the Shop Board.
 *
 *   GET ?key=<app key> → {ok, rates: {"first name lowercased": 62.5, …}}
 *
 * Only the first-name key is returned (never the raw rows), matching how the
 * board canonicalizes names. Simple GET with query key — no CORS preflight.
 */
import * as crypto from "node:crypto";

const SHEET_ID = "11RoeVRETag5rZYX6_tEH-rf6x8JL0JeZU0P5AT0WI-I";
const TAB = "Pay Rates";
const APP_KEY = process.env.BLP_APP_ACCESS_KEY || "pianoman";

let tokenCache: { token: string; exp: number } | null = null;
async function token(): Promise<string> {
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
  const signature = signer.sign(key).toString("base64url");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${header}.${claims}.${signature}` }) });
  const json = (await res.json()) as { access_token: string; expires_in: number };
  tokenCache = { token: json.access_token, exp: now + json.expires_in };
  return json.access_token;
}

export default async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("", { headers: CORS });
  const u = new URL(req.url);
  if ((u.searchParams.get("key") || "") !== APP_KEY) return json({ error: "unauthorized" }, 403);
  try {
    const t = await token();
    const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(`'${TAB}'!A2:B100`)}`,
      { headers: { Authorization: `Bearer ${t}` } });
    const rows = (((await r.json()).values as string[][]) || []);
    const rates: Record<string, number> = {};
    for (const row of rows) {
      const first = String(row[0] || "").trim().split(/\s+/)[0].toLowerCase();
      const rate = parseFloat(String(row[1] || "").replace(/[^0-9.]/g, ""));
      if (first && !first.startsWith("—") && isFinite(rate) && rate > 0) rates[first] = rate;
    }
    return json({ ok: true, rates });
  } catch (e: any) {
    return json({ error: String(e?.message || e) }, 502);
  }
};
const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type",
  "access-control-allow-methods": "GET, OPTIONS" };
function json(o: unknown, status = 200) {
  return new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", ...CORS } });
}
