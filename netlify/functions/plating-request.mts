/**
 * Plating request — webform replacement for the handwritten plating pad.
 * A tech fills the form on a piano's Store Map card; this endpoint
 *   1. appends the survey as a new row on the "Category 3b" tab of the
 *      BLP buffing and electroplating sheet (same columns as the pad), and
 *   2. emails the request to the plating company from
 *      info@brighamlarsonpianos.com (SMTP app password, same env the sales
 *      console uses). Recipient = PLATING_TO_EMAIL, falling back to info@
 *      itself (office forwards) until that env var is set.
 * The client separately stamps the piano's concurrent-task pill
 * ("Submitted") through the existing piano-tasks endpoint.
 *
 *   POST {key?, by?, piano, serial, sendEmail?, f:{…survey fields…}}
 *   → {ok, saved, emailed, note?}
 *
 * Auth: Google ID token (map or shop client) for a company/admin account,
 * or `key` === BLP_APP_ACCESS_KEY (team passcode) — same rules as
 * piano-tasks. CORS-restricted to the map/shop origins.
 */
import * as crypto from "node:crypto";
import { createTransport } from "nodemailer";

const SHEET_ID = "1lIGUxeI-Em3CxhBTSHTrlVM7VFTgjwFCzNxFZNwPTWE";
const TAB = "Category 3b";
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
const INFO = "info@brighamlarsonpianos.com";

async function verifyGoogle(idToken: string): Promise<string | null> {
  if (!idToken) return null;
  const r = await fetch("https://oauth2.googleapis.com/tokeninfo?id_token=" + encodeURIComponent(idToken));
  if (!r.ok) return null;
  const info = (await r.json()) as Record<string, string>;
  if (info.aud !== SHOP_GOOGLE_CLIENT_ID && info.aud !== MAP_GOOGLE_CLIENT_ID) return null;
  if (String(info.email_verified) !== "true") return null;
  const email = String(info.email || "").toLowerCase();
  if (email.endsWith("@" + ADMIN_DOMAIN) || ADMIN_EMAILS.includes(email)) return email;
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

// survey field → Category 3b column, in sheet order (35 columns, A…AI)
const FIELDS: [string, string][] = [
  ["complete", "Plating already complete?"], ["location", "Location"],
  ["pedalsCount", "Pedals — how many"], ["pedalsBrass", "Pedals — solid brass / buffable"],
  ["pedalsRepair", "Pedals — need repair (holes, etc)"], ["pedalsNotes", "Pedals — toe buttons / other notes"],
  ["rodsCount", "Pedal rods (external) — how many"], ["rodsBrass", "Pedal rods — solid brass / buffable"],
  ["lyreCount", "Lyre support rods — how many"], ["lyreBrass", "Lyre support rods — solid brass / buffable"],
  ["trimBrass", "Pedal trim — already brass / buffable"],
  ["chCount", "Continuous hinges — how many"], ["chBrass", "Continuous hinges — solid brass / buffable"],
  ["chLength", "Continuous hinges — length"],
  ["lhCount", "Lid hinges — how many"], ["lhBrass", "Lid hinges — solid brass / buffable"],
  ["lhNotes", "Lid hinges — decorative / bent butt / missing notes"],
  ["fbLock", "Fallboard lock — already brass / buffable"], ["topLock", "Top lid lock (grands) — already brass / buffable"],
  ["escutcheon", "Escutcheon — already brass / buffable"], ["strike", "Fallboard strike plate — already brass / buffable"],
  ["fbhCount", "Fallboard hinges — how many"], ["fbhBrass", "Fallboard hinges — solid brass / buffable"],
  ["fbHardware", "Fallboard hardware — what / how many"], ["fbHwBrass", "Fallboard hardware — solid brass / buffable"],
  ["agraffes", "Agraffes — can they be tumbled?"],
  ["otherItems", "Other (candelabras, etc) — what items"], ["otherBrass", "Other — solid brass / buffable"],
  ["screwTypes", "Screws — head type / diameter / length"], ["screwCounts", "Screws — count of each type"],
  ["photos", "Photos folder (hardware on white posterboard)"],
];

function corsHeaders(origin: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": ALLOW.includes(origin) ? origin : ALLOW[0],
    "Access-Control-Allow-Methods": "POST,OPTIONS",
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
  if (req.method !== "POST") return fail(405, "method not allowed");

  try {
    const body = (await req.json()) as {
      key?: string; by?: string; piano?: string; serial?: string;
      sendEmail?: boolean; f?: Record<string, string>;
    };
    const appKey = process.env.BLP_APP_ACCESS_KEY || "";
    const bearer = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    const googleUser = bearer ? await verifyGoogle(bearer) : null;
    if (!googleUser && !(appKey && body.key === appKey))
      return fail(401, "sign in (or passcode) required");

    const serial = String(body.serial || "").trim();
    const piano = String(body.piano || "").trim();
    if (!serial || !piano) return fail(400, "piano and serial required");
    const f = body.f || {};
    const who = googleUser || String(body.by || "Team").slice(0, 40);
    const today = new Date().toLocaleDateString("en-US", { timeZone: "America/Denver" });

    // 1. save the survey row to Category 3b
    let saved = false, note = "";
    const row = [piano, serial, String(f.notes || ""), "3b notes--->",
      ...FIELDS.map(([k]) => String(f[k] || ""))];
    try {
      const token = await googleToken();
      const r = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(`'${TAB}'!A1`)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
        { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ values: [row] }) }
      );
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error?.message || `HTTP ${r.status}`);
      saved = true;
    } catch (e) {
      note = "Sheet save failed: " + String((e as Error).message || e).slice(0, 140) +
        " — share the plating sheet with the sales service account as Editor";
    }

    // 2. email the request from info@ (unless the tech unchecked it)
    let emailed = false;
    if (body.sendEmail !== false) {
      const pass = process.env.SMTP_PASS || "";
      if (!pass) {
        note += (note ? " · " : "") + "Email not sent: SMTP_PASS not configured";
      } else {
        const to = (process.env.PLATING_TO_EMAIL || INFO).trim();
        const lines = [
          `Plating / buffing request from Brigham Larson Pianos`,
          ``, `Piano: ${piano}`, `Serial: ${serial}`,
          `Requested by: ${who} on ${today}`, ``,
          ...FIELDS.filter(([k]) => String(f[k] || "").trim())
            .map(([k, label]) => `${label}: ${String(f[k]).trim()}`),
          ...(String(f.notes || "").trim() ? ["", `Notes: ${String(f.notes).trim()}`] : []),
          ``, `Please reply to ${INFO} with any questions.`,
          `Brigham Larson Pianos · American Fork, UT`,
        ];
        const transport = createTransport({
          host: process.env.SMTP_HOST || "smtp.gmail.com",
          port: Number(process.env.SMTP_PORT || 465),
          secure: Number(process.env.SMTP_PORT || 465) === 465,
          auth: { user: process.env.SMTP_USER || INFO, pass },
        });
        await transport.sendMail({
          from: `"Brigham Larson Pianos" <${process.env.SMTP_USER || INFO}>`,
          to,
          cc: to.toLowerCase() === INFO ? undefined : INFO,
          replyTo: INFO,
          subject: `Plating request — ${piano} #${serial}`,
          text: lines.join("\n"),
        });
        emailed = true;
        if (to.toLowerCase() === INFO)
          note += (note ? " · " : "") + "Sent to info@ (set PLATING_TO_EMAIL to the plating company's address)";
      }
    }

    return new Response(JSON.stringify({ ok: saved || emailed, saved, emailed, note: note || undefined }),
      { headers });
  } catch (e) {
    return fail(500, String((e as Error).message || e).slice(0, 300));
  }
};
