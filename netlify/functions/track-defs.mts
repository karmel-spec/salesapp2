/**
 * Live track definitions for the Store Map — replaces the manual
 * scripts/fetch_tracks.py snapshot step. Reads the "Sequence by Piano
 * technician" spreadsheet directly (track tabs: row 2 = phases, task rows
 * with merged spans = the phase window; tech specialties tab: skill matrix
 * + intern note) and serves the same JSON shape as data/tracks.json.
 * The map falls back to its static snapshot if this endpoint is down.
 *
 * Cached ~10 minutes (in-memory + CDN) — Brigham's edits appear on the
 * next cache miss, no script run or deploy needed.
 */
import * as crypto from "node:crypto";

const SEQ_ID = "1k9ToAeueEg5WOtaY91xXzL-a0l_AJsSZWw23tcAWECU";
const ALLOW = [
  "https://blpstoremap.netlify.app",
  "https://blpshop.netlify.app",
  "http://localhost:8641",
  "http://localhost:4180",
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
    scope: "https://www.googleapis.com/auth/spreadsheets.readonly",
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

type Cell = { formattedValue?: string; note?: string };
let defsCache: { body: string; at: number } | null = null;

async function buildDefs(): Promise<string> {
  const token = await googleToken();
  const fields = "sheets(properties(title),merges,data(rowData(values(formattedValue,note))))";
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SEQ_ID}?fields=${encodeURIComponent(fields)}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) throw new Error(`Sheets get failed (${res.status})`);
  const doc = (await res.json()) as any;

  const val = (rows: any[], r: number, c: number): string =>
    (((rows[r] || {}).values || [])[c] as Cell | undefined)?.formattedValue?.trim() || "";

  const tracks: Record<string, any> = {};
  let specialties: any = { areas: [], people: [], internNote: "" };

  for (const sh of doc.sheets || []) {
    const title: string = sh.properties?.title || "";
    const rows = sh.data?.[0]?.rowData || [];

    if (title.endsWith(" track")) {
      const phases: string[] = [];
      for (let c = 0; c < 25; c++) { const v = val(rows, 1, c); if (v) phases.push(v); }
      const merges: any[] = sh.merges || [];
      const tasks: any[] = [];
      for (let r = 2; r < rows.length; r++) {
        let name = "", nameCol = -1;
        for (let c = 0; c < 25; c++) { const v = val(rows, r, c); if (v) { name = v; nameCol = c; break; } }
        if (!name) continue;
        const m = merges.find((m: any) => m.startRowIndex === r &&
          m.startColumnIndex <= nameCol && nameCol < m.endColumnIndex);
        const s = m ? m.startColumnIndex : nameCol;
        const e = Math.min(m ? m.endColumnIndex - 1 : nameCol, phases.length - 1);
        tasks.push({ name, start: s, end: e,
          startPhase: phases[s] || "", endPhase: phases[e] || "" });
      }
      tracks[title.slice(0, -" track".length).trim().toLowerCase()] = { phases, tasks };
    }

    if (title.trim().toLowerCase() === "tech specialties") {
      const areas: string[] = [];
      for (let c = 1; c < 30; c++) { const v = val(rows, 1, c); if (v) areas.push(v); }
      let section = "team member";
      const people: any[] = [];
      let internNote = "";
      for (let r = 2; r < rows.length; r++) {
        const a = val(rows, r, 0);
        const note = (((rows[r] || {}).values || [])[0] as Cell | undefined)?.note || "";
        if (note && a.toLowerCase().includes("intern")) internNote = note;
        if (!a) continue;
        const low = a.toLowerCase();
        if (["team members", "subcontractors", "interns"].includes(low)) {
          section = low.replace(/s$/, "");
          continue;
        }
        const skills: Record<string, number> = {};
        areas.forEach((area, i) => {
          const v = val(rows, r, i + 1);
          if (/^\d+$/.test(v) && area.toLowerCase() !== "versatility score") skills[area] = +v;
        });
        people.push({ name: a, role: section, skills });
      }
      specialties = { areas, people, internNote };
    }
  }
  return JSON.stringify({
    generated: new Date().toISOString(),
    source: `https://docs.google.com/spreadsheets/d/${SEQ_ID}/edit`,
    live: true,
    tracks, specialties,
  });
}

export default async (req: Request) => {
  const origin = req.headers.get("origin") || "";
  const headers = {
    "Access-Control-Allow-Origin": ALLOW.includes(origin) ? origin : ALLOW[0],
    "Vary": "Origin",
    "content-type": "application/json",
    "Cache-Control": "public, max-age=600",
  };
  try {
    if (!defsCache || Date.now() - defsCache.at > 10 * 60 * 1000) {
      defsCache = { body: await buildDefs(), at: Date.now() };
    }
    return new Response(defsCache.body, { headers });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error).message || e).slice(0, 200) }),
      { status: 500, headers });
  }
};
