/**
 * Adjustment Log — a durable history of every Planner "Apply adjustments" /
 * "Send answers to Claude" run, on its own tab of the report sheet. The
 * Shop Manager's Planner renders it as the "Adjustment history" panel so
 * Brigham can see that every submission was received, what changed, which
 * standing rules were banked, and whether the revised plan saved.
 *
 * Tab columns: When (Denver) | By | Kind | What you wrote | What Claude did
 *              | Rules remembered | Questions | Plan saved
 */
import * as crypto from "node:crypto";

const SHEET_ID = "11RoeVRETag5rZYX6_tEH-rf6x8JL0JeZU0P5AT0WI-I";
const LOG_TAB = "Adjustment Log";
const HEADER = ["When (Denver)", "By", "Kind", "What you wrote", "What Claude did",
  "Rules remembered", "Questions", "Plan saved"];

let tokenCache: { token: string; exp: number } | null = null;
async function token(): Promise<string> {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || "";
  const key = (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
  const now = Math.floor(Date.now() / 1000);
  if (tokenCache && tokenCache.exp > now + 60) return tokenCache.token;
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const header = b64({ alg: "RS256", typ: "JWT" });
  const claims = b64({ iss: email, scope: "https://www.googleapis.com/auth/spreadsheets",
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

async function api(path: string, method = "GET", body?: unknown): Promise<any> {
  const t = await token();
  const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/${path}`,
    { method, headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined });
  return r.json();
}

/** "2026-08-10 08:42" in shop (Denver) time — used for the log AND the Scheduling Rules tab. */
export function denverStamp(): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Denver",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
}

async function ensureTab(): Promise<void> {
  const meta = await api("?fields=sheets.properties.title");
  const names = (meta.sheets || []).map((s: any) => s.properties?.title);
  if (names.includes(LOG_TAB)) return;
  await api(":batchUpdate", "POST", { requests: [{ addSheet: { properties: { title: LOG_TAB } } }] });
  await api(`values/${encodeURIComponent(`'${LOG_TAB}'!A1`)}?valueInputOption=RAW`, "PUT",
    { values: [HEADER] });
}

const clip = (s: string, n = 4500) => (s.length > n ? s.slice(0, n) + " …[truncated]" : s);

export async function logAdjustment(e: { by: string; kind: string; input: string;
  outcome: string; rules: string[]; questions: string[]; saved: boolean; saveErr?: string }): Promise<void> {
  try {
    await ensureTab();
    await api(`values/${encodeURIComponent(`'${LOG_TAB}'!A1`)}:append?valueInputOption=RAW`, "POST",
      { values: [[denverStamp(), e.by, e.kind, clip(e.input), clip(e.outcome),
        clip((e.rules || []).join("\n")), clip((e.questions || []).join("\n")),
        e.saved ? "yes" : "NO — " + (e.saveErr || "save failed")]] });
  } catch { /* history must never break the adjustment itself */ }
}

export async function readAdjustLog(limit = 50): Promise<string[][]> {
  const j = await api(`values/${encodeURIComponent(`'${LOG_TAB}'!A2:H1000`)}`);
  const rows = (j.values as string[][]) || [];
  return rows.slice(-limit).reverse();   // newest first
}
