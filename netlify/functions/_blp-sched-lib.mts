/** Shared helpers for the scheduled BLP shop jobs (Netlify scheduled functions run in UTC). */
import * as crypto from "node:crypto";
export const REPORT_SHEET = "11RoeVRETag5rZYX6_tEH-rf6x8JL0JeZU0P5AT0WI-I";
export const BRIDGE = "https://script.google.com/macros/s/AKfycbxY4BKnr_Tr0iCTc9itCWhNYLvgszmkI1IoYSkbBWpyAqRtWI-yaUkJQjcVdgG58KXt/exec";
export const SITE = "https://blpsalesapp.netlify.app";
export const KEY = () => process.env.BLP_APP_ACCESS_KEY || "pianoman";
let tokenCache: { token: string; exp: number } | null = null;
export async function googleToken(): Promise<string> {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || "";
  const key = (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
  if (!email || !key) throw new Error("Google service account env not set");
  const now = Math.floor(Date.now() / 1000);
  if (tokenCache && tokenCache.exp > now + 60) return tokenCache.token;
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const header = b64({ alg: "RS256", typ: "JWT" });
  const claims = b64({ iss: email, scope: "https://www.googleapis.com/auth/spreadsheets", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 });
  const signer = crypto.createSign("RSA-SHA256"); signer.update(`${header}.${claims}`);
  const signature = signer.sign(key).toString("base64url");
  const res = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${header}.${claims}.${signature}` }) });
  if (!res.ok) throw new Error(`Google token exchange failed (${res.status})`);
  const j = (await res.json()) as { access_token: string; expires_in: number };
  tokenCache = { token: j.access_token, exp: now + j.expires_in };
  return j.access_token;
}
export async function sheetGet(id: string, range: string): Promise<string[][]> {
  const t = await googleToken();
  const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${encodeURIComponent(range)}?majorDimension=ROWS`, { headers: { Authorization: "Bearer " + t } });
  if (!r.ok) throw new Error(`sheet read ${range} failed (${r.status})`);
  return ((await r.json()) as { values?: string[][] }).values || [];
}
export async function sheetAppend(id: string, tab: string, row: unknown[]) {
  const t = await googleToken();
  await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${encodeURIComponent(`'${tab}'!A1`)}:append?valueInputOption=RAW`,
    { method: "POST", headers: { Authorization: "Bearer " + t, "Content-Type": "application/json" }, body: JSON.stringify({ values: [row] }) });
}
export async function notify(name: string, message: string): Promise<{ ok: boolean; sent?: boolean; reason?: string }> {
  for (let a = 0; a < 2; a++) {
    try {
      const r = await fetch(SITE + "/.netlify/functions/request-notify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ key: KEY(), name, message }) });
      const j = (await r.json()) as { ok: boolean; sent?: boolean; reason?: string };
      if (j && (j.sent || j.reason)) return j;
    } catch { /* retry */ }
    await new Promise(res => setTimeout(res, 15000));
  }
  return { ok: false, sent: false, reason: "relay unreachable" };
}
/** Bridge GET with retry through Google's deploy-time ping/HTML answers. */
export async function bridgeGet(qs: string, want: (j: any) => boolean, tries = 5): Promise<any> {
  for (let a = 0; a < tries; a++) {
    try {
      const r = await fetch(BRIDGE + "?" + qs, { redirect: "follow", signal: AbortSignal.timeout(45000) });
      const txt = await r.text();
      let j: any = null; try { j = JSON.parse(txt); } catch { j = null; }
      if (j && want(j)) return j;
    } catch { /* retry */ }
    await new Promise(res => setTimeout(res, 20000));
  }
  return null;
}
export function denver(d = new Date()) {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", weekday: "short", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", hour12: false }).formatToParts(d);
  const g = (t: string) => p.find(x => x.type === t)?.value || "";
  return { weekday: g("weekday"), y: +g("year"), m: +g("month"), d: +g("day"), h: +g("hour") % 24, min: +g("minute") };
}
export const denverStamp = (d = new Date()) => new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(d);

/* Bottleneck entries are [title, body] pairs — the Planner renders bn[0] as
 * the heading and bn[1] as the text. On 9/25 a revision came back with 33
 * plain STRINGS in plan.bottlenecks (per-piano reconciliation notes), so the
 * Manager Clarification list showed one-letter headings ("T", "2", "1"…).
 * Coerce anything that is not a pair into one; drop empties. */
export function normalizeBottlenecks(list: unknown): string[][] {
  if (!Array.isArray(list)) return [];
  const out: string[][] = [];
  for (const b of list) {
    if (Array.isArray(b)) { const t = String(b[0] ?? "").trim(); if (t) out.push([t, String(b[1] ?? "").trim()]); continue; }
    if (b && typeof b === "object") { const o = b as Record<string, unknown>; const t = String(o.title ?? o.name ?? "").trim(); if (t) out.push([t, String(o.body ?? o.text ?? o.detail ?? "").trim()]); continue; }
    const str = String(b ?? "").trim(); if (!str) continue;
    const m = /^(.{6,90}?)(?:\s+[—–-]\s+|:\s+)(.+)$/s.exec(str);
    out.push(m ? [m[1].trim(), m[2].trim()] : [str.slice(0, 90), str.length > 90 ? str : ""]);
  }
  return out;
}
