/**
 * Friday-report SMS reminders — shared core for the scheduled functions.
 *
 * Texts technicians (via the sales console's Twilio number) when their
 * Friday shop report is missing:
 *   · Friday ~4:30 PM Mountain — first reminder
 *   · Saturday ~noon Mountain  — second reminder if still missing
 *
 * Data:
 *   · Report sheet (REPORT_SHEET_ID): year tabs, technician rows × Friday
 *     columns — a non-empty cell in this week's column = submitted.
 *   · "Tech Phones" tab: Technician | Cell | Reminders on? (YES/NO)
 *   · "Reminder Log" tab: append-only record; also the idempotency guard
 *     (each cron fires at two UTC times to cover MST/MDT — only the one
 *     matching the Denver wall-clock window sends, and a log entry for
 *     the same Friday+type stops any repeat).
 *
 * Env (all already configured for the sales console):
 *   GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY  — Sheets access
 *   TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM_NUMBER
 *   REMINDER_DRY_RUN=1  — log instead of texting (for testing)
 */
import * as crypto from "node:crypto";

const REPORT_SHEET_ID = "11RoeVRETag5rZYX6_tEH-rf6x8JL0JeZU0P5AT0WI-I";
const PHONES_TAB = "Tech Phones";
const LOG_TAB = "Reminder Log";
const APP_URL = "https://blpshop.netlify.app";
const TZ = "America/Denver";
const ACTIVE_WEEKS = 8; // roster = techs with a report in the last N weeks

/* ---------- Google auth (mirrors src/lib/sheets.ts, self-contained) ---------- */
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

async function sheetGet(range: string): Promise<string[][]> {
  const token = await googleToken();
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${REPORT_SHEET_ID}/values/${encodeURIComponent(range)}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) throw new Error(`Sheets read ${range} failed (${res.status}): ${await res.text()}`);
  return ((await res.json()).values as string[][]) || [];
}

async function sheetAppend(range: string, rows: string[][]): Promise<void> {
  const token = await googleToken();
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${REPORT_SHEET_ID}/values/${encodeURIComponent(range)}:append?valueInputOption=RAW`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ values: rows }),
    }
  );
  if (!res.ok) throw new Error(`Sheets append failed (${res.status}): ${await res.text()}`);
}

/* ---------- Twilio (same env + endpoint the sales console uses) ---------- */
async function sendSms(to: string, body: string): Promise<string> {
  if (process.env.REMINDER_DRY_RUN) {
    console.log(`[DRY-RUN] SMS to ${to}: ${body}`);
    return "DRYRUN";
  }
  const sid = process.env.TWILIO_ACCOUNT_SID || "";
  const tok = process.env.TWILIO_AUTH_TOKEN || "";
  const from = process.env.TWILIO_FROM_NUMBER || "";
  if (!sid || !tok || !from) throw new Error("Twilio env not set");
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${sid}:${tok}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      To: to, From: from, Body: body,
      // route through the A2P-registered service when configured (matches src/lib/comms.ts)
      ...(process.env.TWILIO_MESSAGING_SERVICE_SID
        ? { MessagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID }
        : {}),
    }),
  });
  const json = (await res.json()) as { sid?: string; message?: string };
  if (!res.ok) throw new Error(`Twilio send failed (${res.status}): ${json.message || "unknown"}`);
  return json.sid || "?";
}

/* ---------- Denver time helpers ---------- */
function denverParts(d = new Date()) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false, weekday: "short",
  });
  const p: Record<string, string> = {};
  for (const part of fmt.formatToParts(d)) p[part.type] = part.value;
  return {
    iso: `${p.year}-${p.month}-${p.day}`,
    weekday: p.weekday,                    // "Fri", "Sat", …
    hour: parseInt(p.hour === "24" ? "0" : p.hour, 10),
    minute: parseInt(p.minute, 10),
  };
}
function addDaysISO(iso: string, days: number): string {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
const mdShort = (iso: string) => `${parseInt(iso.slice(5, 7), 10)}/${parseInt(iso.slice(8, 10), 10)}`;

/* ---------- core ---------- */
export async function runReminder(kind: "friday" | "saturday"): Promise<string> {
  const now = denverParts();
  const testDate = process.env.REMINDER_TEST_DATE; // e.g. "2026-07-24" — skips the time gate (testing)

  // Denver wall-clock gate: each kind is scheduled at two UTC times so one
  // of them lands in-window year-round (MST vs MDT). The other exits here.
  if (!testDate && kind === "friday" && !(now.weekday === "Fri" && now.hour === 16)) {
    return `skip: Denver time is ${now.weekday} ${now.hour}:${String(now.minute).padStart(2, "0")}, not Fri 16:xx`;
  }
  if (!testDate && kind === "saturday" && !(now.weekday === "Sat" && now.hour === 12)) {
    return `skip: Denver time is ${now.weekday} ${now.hour}:${String(now.minute).padStart(2, "0")}, not Sat 12:xx`;
  }

  const fridayISO = testDate || (kind === "friday" ? now.iso : addDaysISO(now.iso, -1));
  const year = fridayISO.slice(0, 4);

  // Already handled? (double-cron guard + rerun safety)
  const log = await sheetGet(`'${LOG_TAB}'!A1:F5000`);
  if (log.some((r) => (r[1] || "") === fridayISO && (r[2] || "") === kind)) {
    return `skip: ${kind} reminder for ${fridayISO} already logged`;
  }

  // Who submitted? Year tab: row 1 = Friday dates, col A = technician names.
  const grid = await sheetGet(`'${year}'!A1:BA200`);
  if (!grid.length) throw new Error(`year tab ${year} is empty`);
  const dates = grid[0].slice(1).map((c) => {
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec((c || "").trim());
    if (!m) return null;
    const y = m[3].length === 2 ? "20" + m[3] : m[3];
    return `${y}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  });
  const col = dates.indexOf(fridayISO);
  if (col < 0) throw new Error(`no ${fridayISO} column on the ${year} tab`);

  const submitted = new Set<string>();
  const activeSince = addDaysISO(fridayISO, -7 * ACTIVE_WEEKS);
  const roster = new Set<string>();
  for (const row of grid.slice(1)) {
    const tech = (row[0] || "").trim();
    if (!tech) continue;
    const cell = (row[col + 1] || "").trim();
    if (cell && !/^n\/?a$/i.test(cell)) submitted.add(tech.toLowerCase());
    for (let i = 0; i < dates.length; i++) {
      if (dates[i] && dates[i]! >= activeSince && dates[i]! <= fridayISO && (row[i + 1] || "").trim()) {
        roster.add(tech);
        break;
      }
    }
  }

  // Phones: Technician | Cell | Reminders on?
  const phones = new Map<string, string>();
  for (const r of (await sheetGet(`'${PHONES_TAB}'!A2:C100`))) {
    const name = (r[0] || "").trim();
    const cell = (r[1] || "").replace(/[^\d+]/g, "");
    const on = (r[2] || "YES").trim().toUpperCase() !== "NO";
    if (name && cell && on) phones.set(name.toLowerCase(), cell.startsWith("+") ? cell : "+1" + cell.replace(/^1/, ""));
  }

  const missing = [...roster].filter((t) => !submitted.has(t.toLowerCase())).sort();
  const results: string[][] = [];
  const stamp = new Date().toISOString();
  for (const tech of missing) {
    const phone = phones.get(tech.toLowerCase());
    const msg =
      kind === "friday"
        ? `Hi ${tech} — friendly reminder from Brigham Larson Pianos: your Friday shop report for ${mdShort(fridayISO)} hasn't been submitted yet. Please add it before you head out: ${APP_URL} (My Friday Report). / Recordatorio: falta tu reporte del viernes.`
        : `Hi ${tech} — 2nd reminder from Brigham Larson Pianos: your Friday report for ${mdShort(fridayISO)} is still missing. Please submit today: ${APP_URL} / 2do recordatorio: aún falta tu reporte del viernes.`;
    if (!phone) {
      results.push([stamp, fridayISO, kind, tech, "", "NO PHONE on Tech Phones tab"]);
      continue;
    }
    try {
      const sid = await sendSms(phone, msg);
      results.push([stamp, fridayISO, kind, tech, phone, sid]);
    } catch (e) {
      results.push([stamp, fridayISO, kind, tech, phone, "ERROR: " + String((e as Error).message).slice(0, 80)]);
    }
  }
  if (!missing.length) results.push([stamp, fridayISO, kind, "(everyone submitted)", "", "no texts needed"]);
  await sheetAppend(`'${LOG_TAB}'!A1`, results);

  const sent = results.filter((r) => r[5] && !r[5].startsWith("ERROR") && !r[5].startsWith("NO PHONE")).length;
  return `${kind} ${fridayISO}: ${missing.length} missing, ${sent} texted, ${results.length - sent - (missing.length ? 0 : 1)} problems`;
}

/* ---------- Friday 3:30 PM cleaning-assignment texts ----------
   Reads the week's saved assignments from the "Cleaning Log" tab (an
   assignment row has an empty Item) and texts each assignee a link to
   their card. Same phones tab, same log (kind "cleaning"), same
   dual-cron + Denver wall-clock gate as the report reminders. */
const CLEANING_LOG_TAB = "Cleaning Log";

export async function runCleaningReminder(): Promise<string> {
  const now = denverParts();
  const testDate = process.env.REMINDER_TEST_DATE;
  if (!testDate && !(now.weekday === "Fri" && now.hour === 15)) {
    return `skip: Denver time is ${now.weekday} ${now.hour}:${String(now.minute).padStart(2, "0")}, not Fri 15:xx`;
  }
  const fridayISO = testDate || now.iso;

  const log = await sheetGet(`'${LOG_TAB}'!A1:F5000`);
  if (log.some((r) => (r[1] || "") === fridayISO && (r[2] || "") === "cleaning")) {
    return `skip: cleaning reminder for ${fridayISO} already logged`;
  }

  // this week's saved assignments: Week | Card | Item(empty) | Assignee
  const cl = await sheetGet(`'${CLEANING_LOG_TAB}'!A2:F5000`);
  const byTech = new Map<string, string[]>();
  for (const r of cl) {
    if ((r[0] || "").trim() !== fridayISO) continue;
    if ((r[2] || "").trim()) continue;              // item rows = check-offs
    const tech = (r[3] || "").trim();
    if (!tech) continue;
    const card = (r[1] || "").trim();
    if (!byTech.has(tech)) byTech.set(tech, []);
    if (card && !byTech.get(tech)!.includes(card)) byTech.get(tech)!.push(card);
  }

  const phones = new Map<string, string>();
  for (const r of (await sheetGet(`'${PHONES_TAB}'!A2:C100`))) {
    const name = (r[0] || "").trim();
    const cell = (r[1] || "").replace(/[^\d+]/g, "");
    const on = (r[2] || "YES").trim().toUpperCase() !== "NO";
    if (name && cell && on) phones.set(name.toLowerCase(), cell.startsWith("+") ? cell : "+1" + cell.replace(/^1/, ""));
  }

  const results: string[][] = [];
  const stamp = new Date().toISOString();
  for (const [tech, cards] of [...byTech.entries()].sort()) {
    const phone = phones.get(tech.toLowerCase());
    const msg = `Hi ${tech} — Friday cleaning at Brigham Larson Pianos: your assignment is “${cards.join("” + “")}”. ` +
      `Check off each task in the app as you finish: ${APP_URL}/#cleaning / Limpieza del viernes: tu asignación es “${cards.join("” + “")}”.`;
    if (!phone) {
      results.push([stamp, fridayISO, "cleaning", tech, "", "NO PHONE on Tech Phones tab"]);
      continue;
    }
    try {
      const sid = await sendSms(phone, msg);
      results.push([stamp, fridayISO, "cleaning", tech, phone, sid]);
    } catch (e) {
      results.push([stamp, fridayISO, "cleaning", tech, phone, "ERROR: " + String((e as Error).message).slice(0, 80)]);
    }
  }
  if (!byTech.size) results.push([stamp, fridayISO, "cleaning", "(no assignments saved for this week)", "", "no texts sent"]);
  await sheetAppend(`'${LOG_TAB}'!A1`, results);

  const sent = results.filter((r) => r[5] && !r[5].startsWith("ERROR") && !r[5].startsWith("NO PHONE") && r[5] !== "no texts sent").length;
  return `cleaning ${fridayISO}: ${byTech.size} technicians assigned, ${sent} texted`;
}
