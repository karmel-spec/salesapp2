/**
 * Suggestion Box notifier: when a manager flips a request to "Live" (or any
 * status worth telling the requester about), the Shop Manager calls this to
 * text them. Phone comes from the Tech Phones tab by name — the browser
 * never sees numbers.
 *
 *   POST {key, name, message} → {ok, sent}
 */
import * as crypto from "node:crypto";

const SHEET_ID = "11RoeVRETag5rZYX6_tEH-rf6x8JL0JeZU0P5AT0WI-I";
const PHONES_TAB = "Tech Phones";
const APP_KEY = process.env.BLP_APP_ACCESS_KEY || "pianoman";
const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type",
  "access-control-allow-methods": "POST, OPTIONS" };

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
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  let body: any;
  try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }
  if ((body.key || "") !== APP_KEY) return json({ error: "unauthorized" }, 403);
  const name = String(body.name || "").trim();
  const message = String(body.message || "").trim().slice(0, 320);
  if (!name || !message) return json({ error: "name and message required" }, 400);

  const t = await googleToken();
  const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(`'${PHONES_TAB}'!A2:B60`)}`,
    { headers: { Authorization: `Bearer ${t}` } });
  const rows = ((await r.json()).values as string[][]) || [];
  // first-name match is enough — the sheet's names and Google names both
  // start with the person's first name
  const first = name.split(/\s+/)[0].toLowerCase();
  const hit = rows.find(x => (x[0] || "").trim().toLowerCase().startsWith(first));
  const phone = hit && (hit[1] || "").replace(/[^\d+]/g, "");
  if (!phone) return json({ ok: false, sent: false, reason: "no phone on Tech Phones for " + name });

  const sid = process.env.TWILIO_ACCOUNT_SID || "";
  const tok = process.env.TWILIO_AUTH_TOKEN || "";
  const from = process.env.TWILIO_FROM_NUMBER || "";
  if (!sid || !tok || !from) return json({ error: "Twilio env not set" }, 500);
  const to = phone.length === 10 ? "+1" + phone : (phone.startsWith("+") ? phone : "+" + phone);
  const tw = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: { Authorization: "Basic " + Buffer.from(`${sid}:${tok}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ To: to, From: from, Body: message,
      ...(process.env.TWILIO_MESSAGING_SERVICE_SID
        ? { MessagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID } : {}) }) });
  return json({ ok: tw.status < 300, sent: tw.status < 300 });
};
function json(o: unknown, status = 200) {
  return new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", ...CORS } });
}
