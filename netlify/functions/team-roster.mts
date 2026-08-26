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
    ["Uniform size", 22], ["Birthday", 24], ["Phone #", 29], ["BLP email", 30], ["Notes", 34],
  ],
  "Subcontractors/INS": [
    ["First name", 0], ["Last name", 1], ["Phone #", 2], ["Email", 3], ["Company / notes", 4],
  ],
  // the sheet's existing "Former BLP" tab: ITS OWN schema (bio columns),
  // banner on row 1, headers on row 2, data from row 3
  "Former BLP": [
    ["First name", 0], ["Last name", 1], ["Position", 5], ["Start date", 7],
    ["End date", 13], ["Phone #", 8], ["BLP email", 9],
  ],
};
// first DATA row per tab (grid row 2 maps here)
const START: Record<string, number> = { "Former BLP": 3 };
const startRow = (tab: string) => START[tab] || 2;
// Current Team column -> Former BLP column, applied on a move
const MOVE_MAP: [number, number][] = [[0, 0], [1, 1], [3, 5], [6, 7], [29, 8], [30, 9]];
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

// Transitions checklists live on the ops/report sheet — the service account
// is an Editor there, while the BLP TEAM sheet may be read-only for it
const REPORT_SHEET_ID = "11RoeVRETag5rZYX6_tEH-rf6x8JL0JeZU0P5AT0WI-I";
async function sheetsOn(id: string, path: string, init?: RequestInit): Promise<any> {
  const token = await googleToken();
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...init?.headers },
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error?.message || `HTTP ${res.status}`);
  return json;
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
      const ranges = TABS.map((t) => `ranges=${encodeURIComponent(`'${t}'!A${startRow(t)}:BA400`)}`).join("&");
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

    async function ensureTransitionsTab() {
      const meta = await sheetsOn(REPORT_SHEET_ID, `?fields=sheets(properties(title))`);
      if ((meta.sheets || []).some((x: any) => x.properties.title === "Transitions")) return;
      await sheetsOn(REPORT_SHEET_ID, `:batchUpdate`, { method: "POST", body: JSON.stringify({
        requests: [{ addSheet: { properties: { title: "Transitions" } } }] }) });
      await sheetsOn(REPORT_SHEET_ID, `/values/${encodeURIComponent("'Transitions'!A1")}?valueInputOption=USER_ENTERED`,
        { method: "PUT", body: JSON.stringify({ values: [["Name", "Type", "Created", "Updated", "Steps", "Done"]] }) });
    }
    async function ensureTab(title: string, header: string[]) {
      const meta = await sheets(`?fields=sheets(properties(title))`);
      const have = (meta.sheets || []).some((x: any) => x.properties.title === title);
      if (have) return;
      await sheets(`:batchUpdate`, { method: "POST", body: JSON.stringify({
        requests: [{ addSheet: { properties: { title } } }] }) });
      if (header.length) {
        await sheets(`/values/${encodeURIComponent(`'${title}'!A1`)}?valueInputOption=USER_ENTERED`,
          { method: "PUT", body: JSON.stringify({ values: [header] }) });
      }
    }

    if (req.method === "POST") {
      const body = (await req.json()) as {
        key?: string; tab?: string;
        updates?: { row: number; col: number; value: string }[];
        append?: string[];
        move?: { row: number };
        transition?: { row?: number; name: string; type: string; steps: string; done?: boolean };
        listTransitions?: boolean;
      };
      if (!authed(body.key || "")) return fail(401, authErr);

      // ---- transitions (exit / onboarding checklists) ----
      // stored on a "Transitions" tab: Name | Type | Created | Updated | Steps JSON | Done
      if (body.listTransitions) {
        await ensureTransitionsTab();
        const out = await sheetsOn(REPORT_SHEET_ID, `/values/${encodeURIComponent("'Transitions'!A2:F200")}`);
        const rows = (out.values || []).map((r: string[], i: number) => ({
          row: i + 2, name: r[0] || "", type: r[1] || "", created: r[2] || "",
          updated: r[3] || "", steps: r[4] || "{}", done: String(r[5]) === "TRUE" || r[5] === "yes",
        })).filter((x: any) => x.name);
        return new Response(JSON.stringify({ ok: true, transitions: rows }), { headers });
      }
      if (body.transition) {
        await ensureTransitionsTab();
        const t = body.transition;
        const nowIso = new Date().toISOString();
        if (t.row) {
          await sheetsOn(REPORT_SHEET_ID, `/values:batchUpdate`, { method: "POST", body: JSON.stringify({
            valueInputOption: "USER_ENTERED",
            data: [{ range: `'Transitions'!D${t.row}:F${t.row}`,
                     values: [[nowIso, String(t.steps || "{}").slice(0, 20000), t.done ? "yes" : ""]] }],
          }) });
          return new Response(JSON.stringify({ ok: true, row: t.row }), { headers });
        }
        const out = await sheetsOn(REPORT_SHEET_ID,
          `/values/${encodeURIComponent("'Transitions'!A1")}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
          { method: "POST", body: JSON.stringify({ values: [[t.name, t.type, nowIso, nowIso,
              String(t.steps || "{}").slice(0, 20000), ""]] }) });
        const m = /![A-Z]+(\d+)/.exec(out?.updates?.updatedRange || "");
        return new Response(JSON.stringify({ ok: true, row: m ? +m[1] : null }), { headers });
      }

      // ---- move a Current Team row to the Former BLP tab ----
      // The two tabs have different schemas, so display fields are REMAPPED;
      // the complete raw row (payroll columns included) is archived to a
      // "Current Team Archive" tab server-side before the source row is
      // deleted — nothing is ever lost, and the browser never sees it.
      if (body.move) {
        if (body.tab !== "Current Team") return fail(400, "can only move from Current Team");
        const r = body.move.row;                    // grid row (2 = first data row)
        if (!r || r < 2) return fail(400, "bad row");
        const src = await sheets(`/values/${encodeURIComponent(`'Current Team'!A${r}:BA${r}`)}`);
        const rowVals: string[] = ((src.values && src.values[0]) || []).map((x: any) => String(x ?? ""));
        if (!rowVals.some((x) => x.trim())) return fail(400, "row is empty");
        // archive the raw row first
        const curHdr = await sheets(`/values/${encodeURIComponent("'Current Team'!A1:BA1")}`);
        await ensureTab("Current Team Archive", (curHdr.values && curHdr.values[0]) || []);
        await sheets(
          `/values/${encodeURIComponent("'Current Team Archive'!A1")}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
          { method: "POST", body: JSON.stringify({ values: [rowVals] }) });
        // remapped bio row for Former BLP + End date (col 13)
        const dest = new Array(14).fill("");
        MOVE_MAP.forEach(([from, to]) => { dest[to] = rowVals[from] || ""; });
        dest[13] = new Date().toISOString().slice(0, 10);
        await sheets(
          `/values/${encodeURIComponent("'Former BLP'!A1")}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
          { method: "POST", body: JSON.stringify({ values: [dest] }) });
        const meta = await sheets(`?fields=sheets(properties(sheetId,title))`);
        const sheetId = meta.sheets.find((x: any) => x.properties.title === "Current Team").properties.sheetId;
        await sheets(`:batchUpdate`, { method: "POST", body: JSON.stringify({ requests: [{
          deleteDimension: { range: { sheetId, dimension: "ROWS", startIndex: r - 1, endIndex: r } } }] }) });
        return new Response(JSON.stringify({ ok: true, moved: rowVals[0] + " " + rowVals[1] }), { headers });
      }
      const tab = body.tab || "";
      const proj = PROJ[tab];
      if (!proj) return fail(400, "unknown tab");
      if (body.updates?.length) {
        const data = [];
        for (const u of body.updates) {
          const real = proj[u.col - 1];           // grid col (1-based) → real column
          if (!real) return fail(400, `bad column ${u.col}`);
          // grid row 2 = first data row = sheet row startRow(tab)
          const sheetRow = u.row - 2 + startRow(tab);
          data.push({ range: `'${tab}'!${colA1(real[1])}${sheetRow}`, values: [[u.value]] });
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
