/**
 * BLP buffing & electroplating — two-way sync API for the Shop Manager's
 * Plating view. Renders/edits the team's "BLP buffing and electroplating"
 * sheet (in-house polishing log, Category 3b send-out inventory, completed
 * archive) through the sales console's Google service account.
 *
 *   GET  ?key=…             → {tabs: {<tab>: string[][]}, fetchedAt}
 *   POST {key, tab, updates:[{row,col,value}]}   cell edits (1-based row/col)
 *   POST {key, tab, append:[v1,…,vN]}            append a row
 *
 * Auth (either works):
 *   · Authorization: Bearer <Google ID token> — the Shop Manager's sign-in;
 *     verified against Google, must be an admin email / company domain
 *     (mirrors BLPShop's draft-client-update function).
 *   · `key` equal to BLP_APP_ACCESS_KEY (team passcode fallback).
 * CORS-restricted to the shop app origins.
 */
import * as crypto from "node:crypto";

const SHEET_ID = "1lIGUxeI-Em3CxhBTSHTrlVM7VFTgjwFCzNxFZNwPTWE";
const TABS = ["In-house polishing: cat 2 & 3a", "Category 3b", "Completed Pianos"];
// Send-out shipment batches (New England Chrome) — one row per piano per
// batch; auto-created on first read once the SA has Editor on the sheet.
const SHIP_TAB = "Shipments";
const SHIP_HEADERS = ["Batch", "Created", "Serial", "Piano", "Items",
  "Mailed", "Mailed at/by", "Received", "Received at/by", "Notes"];
// same identity rules as the Shop Manager's gate
const SHOP_GOOGLE_CLIENT_ID = "118454775893-17u7t3glh8eu4kffhe7b42jl71apre4f.apps.googleusercontent.com";
const ADMIN_DOMAIN = "brighamlarsonpianos.com";
const ADMIN_EMAILS = ["brighamlarson@gmail.com", "brighamlarsonpianos@gmail.com", "pianoshop.blp@gmail.com"];

async function verifyGoogle(idToken: string): Promise<string | null> {
  if (!idToken) return null;
  const r = await fetch("https://oauth2.googleapis.com/tokeninfo?id_token=" + encodeURIComponent(idToken));
  if (!r.ok) return null;
  const info = (await r.json()) as Record<string, string>;
  if (info.aud !== SHOP_GOOGLE_CLIENT_ID) return null;
  if (String(info.email_verified) !== "true") return null;
  const email = String(info.email || "").toLowerCase();
  if (email.endsWith("@" + ADMIN_DOMAIN) || /\.blp@gmail\.com$/.test(email) || ADMIN_EMAILS.includes(email)) return email;
  return null;
}
const ALLOW = [
  "https://blpshop.netlify.app",
  "http://localhost:4180",
  "http://127.0.0.1:4180",
];

let tokenCache: { token: string; exp: number } | null = null;
async function googleToken(): Promise<string> {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || "";
  const key = (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
  if (!email || !key) throw new Error("Google service account env not set");
  const now = Math.floor(Date.now() / 1000);
  if (tokenCache && tokenCache.exp > now + 60) return tokenCache.token;
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const header = b64({ alg: "RS256", typ: "JWT" });
  const claims = b64({
    iss: email,
    scope: "https://www.googleapis.com/auth/spreadsheets",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  });
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  const signature = signer.sign(key).toString("base64url");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${header}.${claims}.${signature}`,
    }),
  });
  if (!res.ok) throw new Error(`Google token exchange failed (${res.status})`);
  const json = (await res.json()) as { access_token: string; expires_in: number };
  tokenCache = { token: json.access_token, exp: now + json.expires_in };
  return json.access_token;
}

async function sheets(path: string, init?: RequestInit): Promise<any> {
  const token = await googleToken();
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...init?.headers },
  });
  const json = await res.json();
  if (!res.ok) {
    const msg: string = json?.error?.message || `HTTP ${res.status}`;
    const hint = res.status === 403
      ? " — share the BLP buffing and electroplating sheet with the sales service account as Editor"
      : "";
    throw new Error(msg + hint);
  }
  return json;
}

// A1 column letter for a 1-based index (14 cols → fits single letters + AA…)
function colA1(n: number): string {
  let s = "";
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

function corsHeaders(origin: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": ALLOW.includes(origin) ? origin : ALLOW[0],
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "content-type, authorization",
    "Vary": "Origin",
  };
}

export default async (req: Request) => {
  const origin = req.headers.get("origin") || "";
  const base = corsHeaders(origin);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: base });
  const headers = { ...base, "content-type": "application/json" };
  const fail = (status: number, error: string) =>
    new Response(JSON.stringify({ error }), { status, headers });

  try {
    const appKey = process.env.BLP_APP_ACCESS_KEY || "";
    const bearer = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    const googleUser = bearer ? await verifyGoogle(bearer) : null;
    const authed = (key: string) => !!googleUser || (!!appKey && key === appKey);
    const authErr = bearer && !googleUser
      ? "Google sign-in expired or not authorized — reload the page to sign in again"
      : "sign in (or passcode) required";
    if (req.method === "GET") {
      const key = new URL(req.url).searchParams.get("key") || "";
      if (!authed(key)) return fail(401, authErr);
      const get = async (names: string[]) => {
        const ranges = names.map((t) => `ranges=${encodeURIComponent(`'${t}'!A1:BE1200`)}`).join("&");
        return sheets(`/values:batchGet?${ranges}&majorDimension=ROWS`);
      };
      const all = [...TABS, SHIP_TAB];
      const tabs: Record<string, string[][] | null> = {};
      let out: any;
      try {
        out = await get(all);
        all.forEach((t, i) => { tabs[t] = out.valueRanges?.[i]?.values || []; });
      } catch (_) {
        // Shipments tab likely missing — create it (needs Editor), else degrade
        try {
          await sheets(`:batchUpdate`, { method: "POST",
            body: JSON.stringify({ requests: [{ addSheet: { properties: { title: SHIP_TAB } } }] }) });
          await sheets(`/values/${encodeURIComponent(`'${SHIP_TAB}'!A1`)}:append?valueInputOption=RAW`,
            { method: "POST", body: JSON.stringify({ values: [SHIP_HEADERS] }) });
          out = await get(all);
          all.forEach((t, i) => { tabs[t] = out.valueRanges?.[i]?.values || []; });
        } catch (_) {
          out = await get(TABS);
          TABS.forEach((t, i) => { tabs[t] = out.valueRanges?.[i]?.values || []; });
          tabs[SHIP_TAB] = null;  // UI shows "share pending" note
        }
      }
      return new Response(JSON.stringify({ tabs, fetchedAt: new Date().toISOString() }), { headers });
    }
    if (req.method === "POST") {
      const body = (await req.json()) as {
        key?: string; tab?: string;
        updates?: { row: number; col: number; value: string }[];
        append?: string[];
      };
      if (!authed(body.key || "")) return fail(401, authErr);
      const tab = body.tab || "";
      if (!TABS.includes(tab) && tab !== SHIP_TAB) return fail(400, "unknown tab");
      if (body.updates?.length) {
        const data = body.updates.map((u) => ({
          range: `'${tab}'!${colA1(u.col)}${u.row}`,
          values: [[u.value]],
        }));
        await sheets(`/values:batchUpdate`, {
          method: "POST",
          body: JSON.stringify({ valueInputOption: "USER_ENTERED", data }),
        });
        return new Response(JSON.stringify({ ok: true, updated: data.length }), { headers });
      }
      if (body.append) {
        const out = await sheets(
          `/values/${encodeURIComponent(`'${tab}'!A1`)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
          { method: "POST", body: JSON.stringify({ values: [body.append] }) }
        );
        const m = /![A-Z]+(\d+)/.exec(out?.updates?.updatedRange || "");
        return new Response(JSON.stringify({ ok: true, row: m ? +m[1] : null }), { headers });
      }
      return fail(400, "nothing to do");
    }
    return fail(405, "method not allowed");
  } catch (e) {
    return fail(500, String((e as Error).message || e).slice(0, 300));
  }
};
