/**
 * Brigham's priority task list — bridge for the Shop Manager's "Brigham"
 * tab and the Store Map's "Request Brigham Task" button.
 *
 * Backed by the "Brigham Tasks" tab on the Friday-report spreadsheet:
 *   When | Piano | Note | From | Priority | Status | Done date
 *
 *   GET                         → {rows, fetchedAt}   (row 1 = headers)
 *   POST {add:{piano,note,from}}          append an open task
 *   POST {update:{row, priority?, status?, note?}}   edit a task (1-based row)
 *
 * Auth (same as curtis-orders): Google ID token of an admin/company account
 * (Authorization: Bearer …), or `key` = BLP_APP_ACCESS_KEY. Technicians
 * requesting from the Store Map use the team passcode.
 */
import * as crypto from "node:crypto";

const SHEET_ID = "11RoeVRETag5rZYX6_tEH-rf6x8JL0JeZU0P5AT0WI-I";
const TAB = "Brigham Tasks";
const ALLOW = [
  "https://blpshop.netlify.app",
  "https://blpstoremap.netlify.app",
  "http://localhost:4180",
  "http://localhost:8641",
  "http://127.0.0.1:4180",
];
const SHOP_GOOGLE_CLIENT_ID = "118454775893-17u7t3glh8eu4kffhe7b42jl71apre4f.apps.googleusercontent.com";
const MAP_GOOGLE_CLIENT_ID = "110628682621-v65mkaoanv87sp75ggdfcrglfr7bkr8p.apps.googleusercontent.com";
const ADMIN_DOMAIN = "brighamlarsonpianos.com";
const ADMIN_EMAILS = ["brighamlarson@gmail.com", "brighamlarsonpianos@gmail.com", "pianoshop.blp@gmail.com"];

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
    const teamPw = (k: string) => String(k || "").trim().toLowerCase() === "pianoman";  // TEMPORARY bypass while Google sign-in is stabilized
    const authed = (key: string) => !!googleUser || (!!appKey && key === appKey) || teamPw(key);
    const authErr = bearer && !googleUser
      ? "Google sign-in expired or not authorized — reload the page to sign in again"
      : "sign in (or team passcode) required";

    if (req.method === "GET") {
      const key = new URL(req.url).searchParams.get("key") || "";
      if (!authed(key)) return fail(401, authErr);
      const out = await sheets(`/values/${encodeURIComponent(`'${TAB}'!A1:G2000`)}`);
      return new Response(JSON.stringify({ rows: out.values || [], fetchedAt: new Date().toISOString() }), { headers });
    }

    if (req.method === "POST") {
      const body = (await req.json()) as {
        key?: string;
        add?: { piano?: string; note?: string; from?: string };
        update?: { row: number; priority?: string; status?: string; note?: string };
      };
      if (!authed(body.key || "")) return fail(401, authErr);

      if (body.add) {
        const note = String(body.add.note || "").trim();
        if (!note) return fail(400, "note required");
        const from = googleUser || String(body.add.from || "Team").slice(0, 60);
        const when = new Date().toLocaleString("en-US", { timeZone: "America/Denver" });
        await sheets(
          `/values/${encodeURIComponent(`'${TAB}'!A1`)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
          { method: "POST", body: JSON.stringify({ values: [[when, String(body.add.piano || "").slice(0, 80), note.slice(0, 500), from, "", "open", ""]] }) }
        );
        return new Response(JSON.stringify({ ok: true }), { headers });
      }

      if (body.update && body.update.row >= 2) {
        const u = body.update;
        const data: { range: string; values: string[][] }[] = [];
        if (u.priority !== undefined) data.push({ range: `'${TAB}'!E${u.row}`, values: [[String(u.priority)]] });
        if (u.note !== undefined) data.push({ range: `'${TAB}'!C${u.row}`, values: [[String(u.note).slice(0, 500)]] });
        if (u.status !== undefined) {
          data.push({ range: `'${TAB}'!F${u.row}`, values: [[u.status === "done" ? "done" : "open"]] });
          data.push({ range: `'${TAB}'!G${u.row}`, values: [[u.status === "done" ? new Date().toLocaleDateString("en-US", { timeZone: "America/Denver" }) : ""]] });
        }
        if (!data.length) return fail(400, "nothing to update");
        await sheets(`/values:batchUpdate`, {
          method: "POST",
          body: JSON.stringify({ valueInputOption: "USER_ENTERED", data }),
        });
        return new Response(JSON.stringify({ ok: true }), { headers });
      }
      return fail(400, "nothing to do");
    }
    return fail(405, "method not allowed");
  } catch (e) {
    return fail(500, String((e as Error).message || e).slice(0, 300));
  }
};
