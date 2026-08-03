/**
 * BLP TEAM roster — two-way sync for the Shop Manager's "Team Roster" view,
 * so the shop manager can update team info without the front-desk admin.
 *
 * Source: the "BLP TEAM" spreadsheet (Current Team + Subcontractors/INS).
 * SECURITY: the sheet also holds email passwords, W-4/I-9 flags, Venmo, etc.
 * Only a SAFE column subset is projected into the app; updates are mapped
 * back to the real columns, so the sensitive columns are never readable or
 * writable through this bridge.
 *
 *   GET  ?key=…                                   → {tabs, fetchedAt}
 *   POST {key, tab, updates:[{row,col,value}]}    col = projected 1-based index
 *   POST {key, tab, append:[v1,…,vN]}             appends a new row
 *
 * Auth: shop password / BLP_APP_ACCESS_KEY / admin Google token.
 * NOTE: the sheet must be shared with the sales service account as Editor
 * (blp-sales-sync@blp-sales-console.iam.gserviceaccount.com) for writes;
 * reads work if it is at least link-readable.
 */
import * as crypto from "node:crypto";

const SHEET_ID = "1j1FP78rRj1jrl2z-_vIg95kN3GuG8TI4dpOheSnIoPc";
// projected columns per tab: [header shown in the app, real 0-based column]
const PROJ: Record<string, [string, number][]> = {
  "Current Team": [
    ["First name", 0], ["Last name", 1], ["Position", 3], ["Start date", 6],
    ["Uniform size", 22], ["Phone #", 29], ["BLP email", 30], ["Notes", 34],
  ],
  "Subcontractors/INS": [
    ["First name", 0], ["Last name", 1], ["Phone #", 2], ["Email", 3], ["Company / notes", 4],
  ],
};
const TABS = Object.keys(PROJ);
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
  if (!res.ok) {
    const msg: string = json?.error?.message || `HTTP ${res.status}`;
    const hint = res.status === 403
      ? " — share the BLP TEAM sheet with the sales service account as Editor"
      : "";
    throw new Error(msg + hint);
  }
  return json;
}

function colA1(n0: number): string {  // 0-based index → A1 letter
  let n = n0 + 1, s = "";
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
    const teamPw = (k: string) => String(k || "").trim().toLowerCase() === "pianoman";  // TEMPORARY bypass while Google sign-in is stabilized
    const authed = (key: string) => !!googleUser || (!!appKey && key === appKey) || teamPw(key);
    const authErr = "shop password required";

    if (req.method === "GET") {
      const key = new URL(req.url).searchParams.get("key") || "";
      if (!authed(key)) return fail(401, authErr);
      const ranges = TABS.map((t) => `ranges=${encodeURIComponent(`'${t}'!A2:BA400`)}`).join("&");
      const out = await sheets(`/values:batchGet?${ranges}&majorDimension=ROWS`);
      const tabs: Record<string, string[][]> = {};
      TABS.forEach((t, i) => {
        const proj = PROJ[t];
        const raw: string[][] = out.valueRanges?.[i]?.values || [];
        const rows = raw.map((r) => proj.map(([, c]) => (r[c] || "").toString()));
        // drop trailing fully-empty rows, keep sheet row alignment via row index
        while (rows.length && rows[rows.length - 1].every((x) => !x.trim())) rows.pop();
        tabs[t] = [proj.map(([h]) => h), ...rows];
      });
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
      const proj = PROJ[tab];
      if (!proj) return fail(400, "unknown tab");
      if (body.updates?.length) {
        const data = [];
        for (const u of body.updates) {
          const real = proj[u.col - 1];           // grid col (1-based) → real column
          if (!real) return fail(400, `bad column ${u.col}`);
          // grid row 2 = first data row = sheet row 2 (grid header replaces sheet row 1)
          data.push({ range: `'${tab}'!${colA1(real[1])}${u.row}`, values: [[u.value]] });
        }
        await sheets(`/values:batchUpdate`, {
          method: "POST",
          body: JSON.stringify({ valueInputOption: "USER_ENTERED", data }),
        });
        return new Response(JSON.stringify({ ok: true, updated: data.length }), { headers });
      }
      if (body.append) {
        // place projected values into a full-width row at their real columns
        const width = Math.max(...proj.map(([, c]) => c)) + 1;
        const row = new Array(width).fill("");
        proj.forEach(([, c], i) => { row[c] = body.append![i] || ""; });
        const out = await sheets(
          `/values/${encodeURIComponent(`'${tab}'!A1`)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
          { method: "POST", body: JSON.stringify({ values: [row] }) }
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
