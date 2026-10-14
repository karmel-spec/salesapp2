/**
 * Weekly report submit for the Shop app (Avery 10/9, request 100926moore06).
 *
 * Replaces the "blp-shop-reports" Apps Script's submit, which appends what it
 * is sent with no way to tell a resend from a new report: a slow submit that
 * Avery pressed again put her report in her cell three times. That script is
 * Brigham's deploy (still the July version), so the submit lives here now,
 * writing the same cell on the report sheet with the service account.
 *
 *   POST {tech, date: "YYYY-MM-DD" (the week's Friday), text} → {ok, duplicate?, appended?, row, col, label}
 *
 * - The week's column is matched by WEEK, not exact date — headers have been
 *   Thursday dates since 9/22 while the app sends Friday's, which stranded
 *   reports in a new far-right column (the old script's exact-label match).
 *   A missing week gets a new column labelled with that week's Thursday.
 * - Idempotent: if the cell already holds this exact text (whitespace-
 *   insensitive), nothing is written and {duplicate:true} comes back, so
 *   pressing Submit again after a slow or failed reply can never double it.
 * - A double-click race (two writes in flight) is collapsed after the write:
 *   the cell is re-read and a repeated copy of the text is removed.
 *
 * Cleanup (Walter 10/14): POST {action:"replace", key, tech, date, expectMd5, text}
 * overwrites that cell — app key only, and only when the cell's current
 * content still hashes to expectMd5, so it can never clobber a newer edit.
 *
 * Auth: a verified Google ID token (Shop or Store Map client, company /
 * admin / *.blp@gmail accounts) or BLP_APP_ACCESS_KEY; a call with neither is
 * accepted only from the Shop app or Store Map origins, matching the old
 * script (which took anonymous submits) so nobody's Thursday report breaks.
 */
import * as crypto from "node:crypto";

const SHEET_ID = "11RoeVRETag5rZYX6_tEH-rf6x8JL0JeZU0P5AT0WI-I";  // report sheet
const ALLOW = [
  "https://blpshop.netlify.app",
  "http://localhost:4180",
  "http://127.0.0.1:4180",
  "https://blpstoremap.netlify.app",
  "http://localhost:8641",
  "http://127.0.0.1:8641",
];
const SHOP_GOOGLE_CLIENT_ID = "118454775893-17u7t3glh8eu4kffhe7b42jl71apre4f.apps.googleusercontent.com";
const MAP_GOOGLE_CLIENT_ID = "110628682621-v65mkaoanv87sp75ggdfcrglfr7bkr8p.apps.googleusercontent.com";
const ADMIN_DOMAIN = "brighamlarsonpianos.com";
const ADMIN_EMAILS = ["brighamlarson@gmail.com", "brighamlarsonpianos@gmail.com", "pianoshop.blp@gmail.com"];

async function verifyGoogle(idToken: string): Promise<string | null> {
  if (!idToken) return null;
  const r = await fetch("https://oauth2.googleapis.com/tokeninfo?id_token=" + encodeURIComponent(idToken));
  if (!r.ok) return null;
  const info = (await r.json()) as Record<string, string>;
  if (info.aud !== SHOP_GOOGLE_CLIENT_ID && info.aud !== MAP_GOOGLE_CLIENT_ID) return null;
  if (String(info.email_verified) !== "true") return null;
  const email = String(info.email || "").toLowerCase();
  if (email.endsWith("@" + ADMIN_DOMAIN) || /\.blp@gmail\.com$/.test(email) || ADMIN_EMAILS.includes(email)) return email;
  return null;
}

let tokenCache: { token: string; exp: number } | null = null;
async function googleToken(): Promise<string> {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || "";
  const key = (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
  if (!email || !key) throw new Error("Google service account env not set");
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
      assertion: `${header}.${claims}.${signature}` }),
  });
  if (!res.ok) throw new Error(`Google token exchange failed (${res.status})`);
  const json = (await res.json()) as { access_token: string; expires_in: number };
  tokenCache = { token: json.access_token, exp: now + json.expires_in };
  return json.access_token;
}
async function sheets(path: string, init?: RequestInit): Promise<any> {
  const token = await googleToken();
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}${path}`, {
    ...init, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...init?.headers },
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error?.message || `HTTP ${res.status}`);
  return json;
}

/** Monday of the week a "M/D/YY" (or M/D/YYYY) label falls in — same rule as the old script's weekKey_. */
export function weekKey(s: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(String(s || "").trim());
  if (!m) return null;
  const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  const d = new Date(Date.UTC(y, Number(m[1]) - 1, Number(m[2]), 12));
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}`;
}
const colLetter = (n: number) => { let s = ""; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; };
const norm = (t: string) => String(t || "").replace(/\s+/g, " ").trim();
/** the cell with every copy of `text` after the first removed (paragraph-wise) */
export function collapseRepeats(cell: string, text: string): string {
  const want = norm(text);
  if (!want) return cell;
  const paras = String(cell || "").split(/\n{2,}/);
  // the submitted text can itself contain blank lines — match it as a run of paragraphs
  const tParas = String(text).trim().split(/\n{2,}/).length;
  const out: string[] = [];
  let seen = false;
  for (let i = 0; i < paras.length; ) {
    const run = paras.slice(i, i + tParas).join("\n\n");
    if (norm(run) === want) {
      if (!seen) { out.push(...paras.slice(i, i + tParas)); seen = true; }
      i += tParas;
    } else { out.push(paras[i]); i++; }
  }
  return out.join("\n\n");
}

export default async (req: Request) => {
  const origin = req.headers.get("origin") || "";
  const base = {
    "Access-Control-Allow-Origin": ALLOW.includes(origin) ? origin : ALLOW[0],
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Allow-Headers": "content-type, authorization",
    "Vary": "Origin",
  };
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: base });
  const headers = { ...base, "content-type": "application/json" };
  const reply = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers });
  if (req.method !== "POST") return reply({ ok: false, error: "POST only" }, 405);

  try {
    const body = (await req.json()) as { key?: string; tech?: string; date?: string; text?: string; action?: string; expectMd5?: string };
    const bearer = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    const googleUser = bearer ? await verifyGoogle(bearer) : null;
    const appKey = process.env.BLP_APP_ACCESS_KEY || "";
    const authed = !!googleUser || (!!appKey && body.key === appKey) || ALLOW.includes(origin);
    if (!authed) return reply({ ok: false, error: "not allowed" }, 401);

    const tech = String(body.tech || "").trim();
    const text = String(body.text || "").trim();
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(body.date || ""));
    if (!tech) return reply({ ok: false, error: "missing tech" }, 400);
    if (!text) return reply({ ok: false, error: "missing text" }, 400);
    if (!m) return reply({ ok: false, error: "bad date: " + body.date }, 400);
    const year = m[1];
    const friLabel = `${Number(m[2])}/${Number(m[3])}/${year.slice(2)}`;
    const target = weekKey(friLabel)!;

    // the year's tab: named for the year ("2026")
    const meta = await sheets("?fields=sheets.properties.title");
    const tab = ((meta.sheets || []) as { properties: { title: string } }[])
      .map(s => s.properties.title).find(t => t.includes(year));
    if (!tab) return reply({ ok: false, error: "no tab found for year " + year }, 500);
    const q = (r: string) => encodeURIComponent(`'${tab}'!${r}`);

    // week column
    const hdr = ((await sheets(`/values/${q("1:1")}`)).values?.[0] || []) as string[];
    let col = -1;
    for (let c = 1; c < hdr.length; c++) if (weekKey(hdr[c]) === target) { col = c + 1; break; }
    let label = col > 0 ? hdr[col - 1] : "";
    if (col < 0) {
      // new week: Thursday label, the sheet's convention since 9/22
      const thu = new Date(Date.UTC(Number(year), Number(m[2]) - 1, Number(m[3]) - 1, 12));
      label = `${thu.getUTCMonth() + 1}/${thu.getUTCDate()}/${String(thu.getUTCFullYear()).slice(2)}`;
      col = Math.max(hdr.length, 1) + 1;
      await sheets(`/values/${q(colLetter(col) + "1")}?valueInputOption=USER_ENTERED`,
        { method: "PUT", body: JSON.stringify({ values: [[label]] }) });
    }

    // tech row
    const names = ((await sheets(`/values/${q("A:A")}`)).values || []) as string[][];
    let row = -1;
    for (let r = 1; r < names.length; r++) {
      if (String(names[r]?.[0] || "").trim().toLowerCase() === tech.toLowerCase()) { row = r + 1; break; }
    }
    if (row < 0) {
      row = names.length + 1;
      await sheets(`/values/${q("A" + row)}?valueInputOption=RAW`, { method: "PUT", body: JSON.stringify({ values: [[tech]] }) });
    }

    const a1 = colLetter(col) + row;
    const read = async () => String(((await sheets(`/values/${q(a1)}`)).values?.[0]?.[0]) || "");
    if (body.action === "replace") {
      if (!appKey || body.key !== appKey) return reply({ ok: false, error: "replace needs the app key" }, 401);
      const cur = await read();
      const md5 = crypto.createHash("md5").update(cur, "utf8").digest("hex");
      if (!body.expectMd5 || md5 !== body.expectMd5) return reply({ ok: false, error: "cell changed since it was read", md5 }, 409);
      await sheets(`/values/${q(a1)}?valueInputOption=RAW`, { method: "PUT", body: JSON.stringify({ values: [[text]] }) });
      return reply({ ok: true, replaced: true, row, col, label, was: cur.length, now: text.length });
    }
    const existing = (await read()).trim();
    if (existing && norm(existing).includes(norm(text))) {
      return reply({ ok: true, duplicate: true, row, col, label });   // already there — a resend
    }
    const isPlaceholder = existing === "" || /^n\/?a$/i.test(existing);
    const next = isPlaceholder ? text : existing + "\n\n" + text;
    await sheets(`/values/${q(a1)}?valueInputOption=RAW`, { method: "PUT", body: JSON.stringify({ values: [[next]] }) });

    // double-click race: two writes that both read the old cell — keep one copy
    const after = await read();
    const fixed = collapseRepeats(after, text);
    if (fixed !== after) {
      await sheets(`/values/${q(a1)}?valueInputOption=RAW`, { method: "PUT", body: JSON.stringify({ values: [[fixed]] }) });
    }
    return reply({ ok: true, appended: !isPlaceholder, row, col, label });
  } catch (e) {
    return reply({ ok: false, error: String((e as Error).message || e).slice(0, 300) }, 500);
  }
};

export const config = { path: "/.netlify/functions/weekly-report" };
