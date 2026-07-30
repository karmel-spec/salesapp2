/**
 * Friday cleaning system — replaces the laminated "Friday Shop Organization"
 * cards. Card definitions live on the report sheet's "Cleaning Cards" tab
 * (Card | Item — Brigham edits freely); weekly assignments + check-offs live
 * on "Cleaning Log" (Week | Card | Item | Assignee | Done at | By).
 * An assignment row has an empty Item; item rows carry the check-off stamp.
 *
 *   GET  ?week=YYYY-MM-DD          → {cards:{card:[items]}, log:[…], fetchedAt}
 *   POST {key?, week, card, action:"assign", assignee, by}
 *   POST {key?, week, card, action:"mark", item, on, by}
 *
 * Auth: Google ID token (shop or map client) for company domain, admins, or
 * technician *.blp@gmail.com accounts — or `key` === BLP_APP_ACCESS_KEY.
 */
import * as crypto from "node:crypto";

const SHEET_ID = "11RoeVRETag5rZYX6_tEH-rf6x8JL0JeZU0P5AT0WI-I";  // report sheet
const CARDS_TAB = "Cleaning Cards";
const LOG_TAB = "Cleaning Log";
const ALLOW = [
  "https://blpshop.netlify.app",
  "https://blpstoremap.netlify.app",
  "http://localhost:4180",
  "http://127.0.0.1:4180",
  "http://localhost:8641",
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
  if (!res.ok) throw new Error(json?.error?.message || `HTTP ${res.status}`);
  return json;
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
      const url = new URL(req.url);
      if (!authed(url.searchParams.get("key") || "")) return fail(401, authErr);
      const week = (url.searchParams.get("week") || "").trim();
      const out = await sheets(`/values:batchGet?ranges=${encodeURIComponent(`'${CARDS_TAB}'!A2:B400`)}&ranges=${encodeURIComponent(`'${LOG_TAB}'!A2:F5000`)}&majorDimension=ROWS`);
      const cards: Record<string, string[]> = {};
      for (const r of out.valueRanges?.[0]?.values || []) {
        const c = (r[0] || "").trim(), it = (r[1] || "").trim();
        if (!c || !it) continue;
        (cards[c] = cards[c] || []).push(it);
      }
      const log = (out.valueRanges?.[1]?.values || []).map((r: string[], i: number) => ({
        row: i + 2, week: (r[0] || "").trim(), card: (r[1] || "").trim(),
        item: (r[2] || "").trim(), assignee: (r[3] || "").trim(),
        doneAt: (r[4] || "").trim(), by: (r[5] || "").trim(),
      })).filter((x: any) => x.week && (!week || x.week === week));
      return new Response(JSON.stringify({ cards, log, fetchedAt: new Date().toISOString() }), { headers });
    }

    if (req.method === "POST") {
      const body = (await req.json()) as {
        key?: string; week?: string; card?: string; action?: string;
        assignee?: string; item?: string; on?: boolean; by?: string;
      };
      if (!authed(body.key || "")) return fail(401, authErr);
      const week = String(body.week || "").trim();
      const card = String(body.card || "").trim();
      if (!week || !card) return fail(400, "week and card required");
      const who = googleUser || String(body.by || "Team").slice(0, 40);
      const item = body.action === "assign" ? "" : String(body.item || "").trim();
      if (body.action !== "assign" && !item) return fail(400, "item required");
      const stamp = new Date().toLocaleDateString("en-US", { timeZone: "America/Denver" });

      const cur = await sheets(`/values/${encodeURIComponent(`'${LOG_TAB}'!A2:C5000`)}?majorDimension=ROWS`);
      const rows: string[][] = cur.values || [];
      let rowNum = 0;
      rows.forEach((r, i) => {
        if ((r[0] || "").trim() === week && (r[1] || "").trim() === card &&
            ((r[2] || "").trim().toLowerCase() === item.toLowerCase())) rowNum = i + 2;
      });
      const vals = body.action === "assign"
        ? { range: "D", data: [[String(body.assignee || "").slice(0, 40), "", who]] }
        : { range: "E", data: [[body.on === false ? "" : stamp, body.on === false ? "" : who]] };

      if (rowNum) {
        await sheets(`/values/${encodeURIComponent(`'${LOG_TAB}'!${vals.range}${rowNum}`)}?valueInputOption=RAW`,
          { method: "PUT", body: JSON.stringify({ values: vals.data }) });
      } else {
        const row = body.action === "assign"
          ? [week, card, "", String(body.assignee || "").slice(0, 40), "", who]
          : [week, card, item, "", body.on === false ? "" : stamp, body.on === false ? "" : who];
        await sheets(`/values/${encodeURIComponent(`'${LOG_TAB}'!A1`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
          { method: "POST", body: JSON.stringify({ values: [row] }) });
      }
      return new Response(JSON.stringify({ ok: true }), { headers });
    }
    return fail(405, "method not allowed");
  } catch (e) {
    return fail(500, String((e as Error).message || e).slice(0, 300));
  }
};
