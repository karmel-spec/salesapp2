/**
 * Shop whiteboard — the wall board's digital twin. Three columns
 * (Parts / Supplies / Tools) of ordering requests on the report sheet's
 * "Whiteboard" tab: Column | Item | Note | Added by | Added | Done | Done at/by.
 *
 *   GET  ?key=…                                → {rows:[…], fetchedAt}
 *   POST {key, action:"add", column, item, note?, by}
 *   POST {key, action:"done", row, on, by}     ✓ handled / un-handle
 *   POST {key, action:"note", row, note, by}   edit an item's note
 *
 * Auth: shop password / BLP_APP_ACCESS_KEY / admin Google token.
 */
import * as crypto from "node:crypto";

const SHEET_ID = "11RoeVRETag5rZYX6_tEH-rf6x8JL0JeZU0P5AT0WI-I";  // report sheet
const TAB = "Whiteboard";
const COLUMNS = ["Parts", "Supplies", "Tools"];
const ALLOW = [
  "https://blpshop.netlify.app",
  "http://localhost:4180",
  "http://127.0.0.1:4180",
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

    if (req.method === "GET") {
      const key = new URL(req.url).searchParams.get("key") || "";
      if (!authed(key)) return fail(401, "shop password required");
      const out = await sheets(`/values/${encodeURIComponent(`'${TAB}'!A2:G2000`)}?majorDimension=ROWS`);
      const rows = ((out.values as string[][]) || []).map((r, i) => ({
        row: i + 2,
        column: (r[0] || "").trim(), item: (r[1] || "").trim(), note: (r[2] || "").trim(),
        by: (r[3] || "").trim(), added: (r[4] || "").trim(),
        done: (r[5] || "").trim() === "TRUE", doneAt: (r[6] || "").trim(),
      })).filter((x) => x.item);
      return new Response(JSON.stringify({ rows, fetchedAt: new Date().toISOString() }), { headers });
    }

    if (req.method === "POST") {
      const body = (await req.json()) as {
        key?: string; action?: string; column?: string; item?: string;
        note?: string; row?: number; on?: boolean; by?: string;
      };
      if (!authed(body.key || "")) return fail(401, "shop password required");
      const who = String(body.by || "").trim().slice(0, 40) || googleUser || "Team";
      const stamp = new Date().toLocaleDateString("en-US", { timeZone: "America/Denver" }) + " · " + who;

      if (body.action === "add") {
        const column = COLUMNS.find((c) => c.toLowerCase() === String(body.column || "").trim().toLowerCase());
        const item = String(body.item || "").trim().slice(0, 200);
        if (!column || !item) return fail(400, "column and item required");
        const today = new Date().toLocaleDateString("en-US", { timeZone: "America/Denver" });
        await sheets(
          `/values/${encodeURIComponent(`'${TAB}'!A1`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
          { method: "POST", body: JSON.stringify({ values: [[column, item, String(body.note || "").slice(0, 200), who, today, "FALSE", ""]] }) }
        );
        return new Response(JSON.stringify({ ok: true }), { headers });
      }
      if (body.action === "done" || body.action === "note") {
        const row = Math.floor(Number(body.row || 0));
        if (row < 2 || row > 5000) return fail(400, "bad row");
        const data = body.action === "done"
          ? [{ range: `'${TAB}'!F${row}`, values: [[body.on === false ? "FALSE" : "TRUE"]] },
             { range: `'${TAB}'!G${row}`, values: [[body.on === false ? "" : stamp]] }]
          : [{ range: `'${TAB}'!C${row}`, values: [[String(body.note || "").slice(0, 200)]] }];
        await sheets(`/values:batchUpdate`, {
          method: "POST",
          body: JSON.stringify({ valueInputOption: "RAW", data }),
        });
        return new Response(JSON.stringify({ ok: true }), { headers });
      }
      return fail(400, "unknown action");
    }
    return fail(405, "method not allowed");
  } catch (e) {
    return fail(500, String((e as Error).message || e).slice(0, 300));
  }
};
