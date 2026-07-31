/**
 * Per-piano concurrent-task status — bridge for the Store Map data cards.
 *
 * Track definitions (which tasks apply, and their phase windows) come from
 * the map's data/tracks.json snapshot; THIS endpoint stores each piano's
 * progress on those tasks in the "Task Status" tab of the Piano Log:
 *   Serial | Task | Part | Step 1 | Step 1 at/by | Step 2 | Step 2 at/by | Updated
 *
 * Two-step tasks (order decal → Ordered/Received, electroplating →
 * Mailed/Received, each ordered part → Ordered/Received) use both step
 * columns; one-step tasks stamp only Step 2 ("Done").
 *
 *   GET  ?serial=12345                       → {rows:[{row,task,part,step1,step1At,step2,step2At}]}
 *   POST {serial, task, part?, step:1|2, label, on:true|false, by?}
 *        marks/unmarks a step; creates the row if it doesn't exist
 *
 * Auth: Google ID token (company account) or `key` = BLP_APP_ACCESS_KEY.
 */
import * as crypto from "node:crypto";

const SHEET_ID = "1ZunbPKygpQlcXfTyPowDHdUE9spJ3uV1XA4iX1eoKRc";  // Piano Log
const TAB = "Task Status";
const ALLOW = [
  "https://blpstoremap.netlify.app",
  "https://blpshop.netlify.app",
  "http://localhost:8641",
  "http://localhost:4180",
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
  if (!res.ok) {
    const msg: string = json?.error?.message || `HTTP ${res.status}`;
    const hint = res.status === 403
      ? " — share the Piano Log with the sales service account as Editor"
      : "";
    throw new Error(msg + hint);
  }
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

const norm = (s: string) => String(s || "").trim().toLowerCase();

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
      ? "Google sign-in expired or not authorized — sign in again"
      : "sign in (or team passcode) required";

    if (req.method === "GET") {
      const url = new URL(req.url);
      const serial = norm(url.searchParams.get("serial") || "");
      if (!serial) return fail(400, "serial required");
      // reads are open: the sheet itself is link-readable and this powers the card view
      const out = await sheets(`/values/${encodeURIComponent(`'${TAB}'!A2:H3000`)}`);
      const rows = (out.values || [])
        .map((r: string[], i: number) => ({
          row: i + 2,
          serial: (r[0] || "").trim(), task: (r[1] || "").trim(), part: (r[2] || "").trim(),
          step1: (r[3] || "").trim(), step1At: (r[4] || "").trim(),
          step2: (r[5] || "").trim(), step2At: (r[6] || "").trim(),
        }))
        .filter((r: any) => norm(r.serial) === serial);
      return new Response(JSON.stringify({ rows, fetchedAt: new Date().toISOString() }), { headers });
    }

    if (req.method === "POST") {
      const body = (await req.json()) as {
        key?: string; serial?: string; task?: string; part?: string;
        step?: number; label?: string; on?: boolean; by?: string;
      };
      if (!authed(body.key || "")) return fail(401, authErr);
      const serial = String(body.serial || "").trim();
      const task = String(body.task || "").trim();
      const part = String(body.part || "").trim();
      const step = body.step === 1 ? 1 : 2;
      const label = String(body.label || (step === 1 ? "Ordered" : "Done")).slice(0, 20);
      if (!serial || !task) return fail(400, "serial and task required");

      const who = String(body.by || "").trim().slice(0, 40) || googleUser || "Team";
      const stampVal = body.on === false ? "" :
        `${new Date().toLocaleDateString("en-US", { timeZone: "America/Denver" })} · ${who}`;

      const out = await sheets(`/values/${encodeURIComponent(`'${TAB}'!A2:C3000`)}`);
      const rows: string[][] = out.values || [];
      let rowNum = 0;
      for (let i = 0; i < rows.length; i++) {
        if (norm(rows[i][0]) === norm(serial) && norm(rows[i][1]) === norm(task) &&
            norm(rows[i][2] || "") === norm(part)) { rowNum = i + 2; break; }
      }
      const nowIso = new Date().toISOString();
      if (!rowNum) {
        const append = await sheets(
          `/values/${encodeURIComponent(`'${TAB}'!A1`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
          { method: "POST", body: JSON.stringify({ values: [[serial, task, part,
              step === 1 ? label : "", step === 1 ? stampVal : "",
              step === 2 ? label : "", step === 2 ? stampVal : "", nowIso]] }) }
        );
        const m = /![A-Z]+(\d+)/.exec(append?.updates?.updatedRange || "");
        return new Response(JSON.stringify({ ok: true, row: m ? +m[1] : null }), { headers });
      }
      const lblCol = step === 1 ? "D" : "F";
      const valCol = step === 1 ? "E" : "G";
      await sheets(`/values:batchUpdate`, {
        method: "POST",
        body: JSON.stringify({ valueInputOption: "RAW", data: [
          { range: `'${TAB}'!${lblCol}${rowNum}`, values: [[label]] },
          { range: `'${TAB}'!${valCol}${rowNum}`, values: [[stampVal]] },
          { range: `'${TAB}'!H${rowNum}`, values: [[nowIso]] },
        ] }),
      });
      return new Response(JSON.stringify({ ok: true, row: rowNum }), { headers });
    }
    return fail(405, "method not allowed");
  } catch (e) {
    return fail(500, String((e as Error).message || e).slice(0, 300));
  }
};
