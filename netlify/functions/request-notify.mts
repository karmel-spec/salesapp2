/**
 * Suggestion Box notifier: when a manager flips a request to "Live" (or any
 * status worth telling the requester about), the Shop Manager calls this to
 * text them. Phone comes from the Tech Phones tab by name — the browser
 * never sees numbers.
 *
 *   POST {key, name, message} → {ok, sent}
 */
import * as crypto from "node:crypto";
import { loadSettings } from "./app-settings.mts";

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
  // 1200 not 320: the late-clock nudge (piano list + fix link) and the
  // Brigham/Karmel sweep summaries run long — 320 was cutting the link off
  const message = String(body.message || "").trim().slice(0, 1200);
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

  // QUIET HOURS (Brigham 9/3): team members only get texts 10am–4pm Denver.
  // Exempt: weekly-report + timeclock/punch texts, the mini-QC loop (a tech
  // is standing at the piano waiting for the verdict), and owners/managers
  // (their summary + escalation texts are the point). Outside the window a
  // non-exempt text is handed to Twilio with SendAt = next 10:00 Denver —
  // Twilio holds and delivers it, no queue of our own to babysit.
  const mss = process.env.TWILIO_MESSAGING_SERVICE_SID || "";
  // window + exemptions are EDITABLE on the Settings page (App Settings tab)
  let qStart = 10, qEnd = 16,
    exNames = ["brigham", "karmel", "mark", "melissa"],
    exWords = ["weekly report", "time clock", "timeclock", "clock fix", "clock in", "clock out", "punch", "mini-qc", "miniqc", "rework"];
  try {
    const st = (await loadSettings()).settings;
    if (st.quiet_start) qStart = Number(st.quiet_start);
    if (st.quiet_end) qEnd = Number(st.quiet_end);
    if (st.quiet_exempt_names) exNames = st.quiet_exempt_names.split(",").map(x => x.trim().toLowerCase()).filter(Boolean);
    if (st.quiet_exempt_keywords) exWords = st.quiet_exempt_keywords.split(",").map(x => x.trim().toLowerCase()).filter(Boolean);
  } catch { /* settings unreachable — built-in defaults */ }
  const dvParts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver",
    hour12: false, hour: "2-digit", minute: "2-digit" }).formatToParts(new Date());
  const hr = Number(dvParts.find(x => x.type === "hour")?.value || 12);
  const inWindow = hr >= qStart && hr < qEnd;
  const low = message.toLowerCase();
  const exempt = body.now === true || exNames.includes(first) || exWords.some(w => low.includes(w));
  // no Twilio Messaging Service on this account → hold the text in the
  // shared Supabase queue instead; sms-quiet-cron delivers it after 10am
  if (!inWindow && !exempt && !mss && process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) {
    const qr = await fetch(`${process.env.SUPABASE_URL}/rest/v1/bridge_queue`, {
      method: "POST",
      headers: { apikey: process.env.SUPABASE_SERVICE_KEY, Authorization: "Bearer " + process.env.SUPABASE_SERVICE_KEY,
        "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ action: "sms", status: "sms-queued", payload: { name, message } }) });
    if (qr.ok) return json({ ok: true, sent: false, queued: true, sendAt: "next 10:00 AM Denver" });
    // queue unreachable — never drop a message: fall through and send now
  }
  let sendAt = "";
  if (!inWindow && !exempt && mss) {
    const nowMs = Date.now();
    // next 10:00 Denver: walk forward in 30-min steps until the Denver
    // clock reads 10:xx on a moment ≥ today (DST-proof, no tz math)
    let t = new Date(nowMs);
    for (let i = 0; i < 60; i++) {
      const h2 = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver",
        hour12: false, hour: "2-digit" }).format(t));
      if (h2 === 10 && t.getTime() > nowMs) break;
      t = new Date(t.getTime() + 30 * 60000);
    }
    if (t.getTime() - nowMs > 16 * 60000) sendAt = new Date(Math.floor(t.getTime() / 60000) * 60000).toISOString();
  }
  const params: Record<string, string> = { To: to, Body: message };
  if (sendAt) { params.MessagingServiceSid = mss; params.ScheduleType = "fixed"; params.SendAt = sendAt; }
  else if (mss) { params.MessagingServiceSid = mss; params.From = from; }
  else params.From = from;
  const tw = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: { Authorization: "Basic " + Buffer.from(`${sid}:${tok}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params) });
  if (sendAt && tw.status >= 300) {
    // scheduling refused (e.g. number not on the messaging service) — never
    // drop a message: send it now and say so
    const tw2 = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: { Authorization: "Basic " + Buffer.from(`${sid}:${tok}`).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ To: to, From: from, Body: message }) });
    return json({ ok: tw2.status < 300, sent: tw2.status < 300, scheduleFailed: true });
  }
  return json({ ok: tw.status < 300, sent: tw.status < 300,
    ...(sendAt ? { scheduled: true, sendAt } : {}) });
};
function json(o: unknown, status = 200) {
  return new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", ...CORS } });
}
