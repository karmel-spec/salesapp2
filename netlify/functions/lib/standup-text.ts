/**
 * 7:50 AM standup text — the morning shop brief, condensed, to the managers.
 *
 * Mark, Brigham, Karmel, Matthew and Jacob get a short text ten minutes
 * before the 8:00 standup: today's birthdays / anniversaries / new faces,
 * yesterday's clock leader, the safety minute, the standard of the day, and
 * a link to last night's full brief (already archived as a Google Doc).
 *
 * Weekdays only, and never on Christmas Eve, Christmas, New Year's Day,
 * Thanksgiving, or the 4th of July.
 *
 * The digest itself is built by the Store Map bridge (action "briefsms") so
 * the wording stays in one place with the emailed brief. This function owns
 * the schedule, the holiday calendar, the roster lookup, and the sending.
 *
 * Env (all already configured for the sales console):
 *   GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY  — Sheets access
 *   TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM_NUMBER
 *   STOREMAP_TEAM_PIN   — authorizes the bridge call
 *   STANDUP_DRY_RUN=1   — log instead of texting
 *   STANDUP_TEST=1      — skip the 7:50 wall-clock gate (for a manual run)
 */
import * as crypto from "node:crypto";

const REPORT_SHEET_ID = "11RoeVRETag5rZYX6_tEH-rf6x8JL0JeZU0P5AT0WI-I";
const PHONES_TAB = "Tech Phones";
const LOG_TAB = "Standup Text Log";
const BRIDGE_URL =
  "https://script.google.com/macros/s/AKfycbxY4BKnr_Tr0iCTc9itCWhNYLvgszmkI1IoYSkbBWpyAqRtWI-yaUkJQjcVdgG58KXt/exec";
const TZ = "America/Denver";

/** First names on the Tech Phones tab who get the standup text. */
const RECIPIENTS = ["Mark", "Brigham", "Karmel", "Matthew", "Jacob"];

/* ---------- Google auth (same self-contained pattern as report-reminders) ---------- */
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
  if (!res.ok) throw new Error(`Sheets read ${range} failed (${res.status})`);
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
  if (!res.ok) throw new Error(`Sheets append failed (${res.status})`);
}

/* ---------- Twilio ---------- */
async function sendSms(to: string, body: string): Promise<string> {
  if (process.env.STANDUP_DRY_RUN) {
    console.log(`[DRY-RUN] standup SMS to ${to}:\n${body}`);
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
      ...(process.env.TWILIO_MESSAGING_SERVICE_SID
        ? { MessagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID }
        : {}),
    }),
  });
  const json = (await res.json()) as { sid?: string; message?: string };
  if (!res.ok) throw new Error(`Twilio send failed (${res.status}): ${json.message || "unknown"}`);
  return json.sid || "?";
}

/* ---------- Denver wall clock ---------- */
function denverParts(d = new Date()) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false, weekday: "short",
  });
  const p: Record<string, string> = {};
  for (const part of fmt.formatToParts(d)) p[part.type] = part.value;
  return {
    iso: `${p.year}-${p.month}-${p.day}`,
    weekday: p.weekday,                       // "Mon" … "Sun"
    hour: parseInt(p.hour === "24" ? "0" : p.hour, 10),
    minute: parseInt(p.minute, 10),
  };
}

/* ---------- holidays: no standup text on these ----------
   Fixed dates plus Thanksgiving (4th Thursday of November). Independence
   Day and New Year's Day are listed on their real date — when one lands on
   a weekend the weekday gate already covers it, and BLP doesn't hold the
   standup on an observed-Monday, so no substitution rule here. */
function thanksgivingISO(year: number): string {
  // 1st of November, walk to the first Thursday, then add 3 weeks
  const first = new Date(Date.UTC(year, 10, 1));
  const dow = first.getUTCDay();                 // 0=Sun … 4=Thu
  const firstThu = 1 + ((4 - dow + 7) % 7);
  const day = firstThu + 21;
  return `${year}-11-${String(day).padStart(2, "0")}`;
}
export function holidayName(iso: string): string | null {
  const md = iso.slice(5);
  if (md === "12-24") return "Christmas Eve";
  if (md === "12-25") return "Christmas";
  if (md === "01-01") return "New Year's Day";
  if (md === "07-04") return "Independence Day";
  if (iso === thanksgivingISO(Number(iso.slice(0, 4)))) return "Thanksgiving";
  return null;
}

/* ---------- roster ---------- */
async function recipientNumbers(): Promise<{ name: string; phone: string }[]> {
  const rows = await sheetGet(`'${PHONES_TAB}'!A2:B60`);
  const out: { name: string; phone: string }[] = [];
  for (const want of RECIPIENTS) {
    const hit = rows.find(
      (r) => (r[0] || "").trim().toLowerCase().split(/\s+/)[0] === want.toLowerCase()
    );
    if (!hit) continue;
    let digits = (hit[1] || "").replace(/\D/g, "");
    if (digits.length === 10) digits = "1" + digits;
    if (digits.length !== 11) continue;
    out.push({ name: want, phone: "+" + digits });
  }
  return out;
}

/* ---------- core ---------- */
export async function runStandupText(): Promise<string> {
  const now = denverParts();
  const test = process.env.STANDUP_TEST;

  // Denver wall-clock gate: scheduled at two UTC times so one lands in the
  // 7:50 window year-round (MST vs MDT); the other exits here.
  if (!test && !(now.hour === 7 && now.minute >= 40 && now.minute < 59)) {
    return `skip: Denver time is ${now.hour}:${String(now.minute).padStart(2, "0")}, not the 7:50 window`;
  }
  if (!test && ["Sat", "Sun"].includes(now.weekday)) {
    return `skip: ${now.weekday} — weekdays only`;
  }
  const holiday = holidayName(now.iso);
  if (!test && holiday) return `skip: ${holiday} (${now.iso}) — no standup text`;

  // one send per day, even though two crons fire
  const log = await sheetGet(`'${LOG_TAB}'!A1:D2000`).catch(() => [] as string[][]);
  if (!test && log.some((r) => (r[0] || "") === now.iso)) {
    return `skip: standup text for ${now.iso} already sent`;
  }

  // the digest comes from the bridge, so it matches the emailed brief
  const res = await fetch(BRIDGE_URL, {
    method: "POST",
    redirect: "follow",
    headers: { "content-type": "text/plain;charset=utf-8" },
    body: JSON.stringify({
      pin: process.env.STOREMAP_TEAM_PIN || "",
      action: "briefsms",
      user: { name: "Standup text" },
    }),
  });
  const payload = (await res.json()) as { ok?: boolean; text?: string; error?: string };
  if (!payload.ok || !payload.text) {
    throw new Error("bridge briefsms failed: " + (payload.error || "no text"));
  }
  const body = payload.text;

  const people = await recipientNumbers();
  if (!people.length) throw new Error("no recipient numbers found on Tech Phones");

  const sent: string[] = [], failed: string[] = [];
  for (const p of people) {
    try { await sendSms(p.phone, body); sent.push(p.name); }
    catch (e) { failed.push(`${p.name} (${(e as Error).message})`); }
  }

  try {
    await sheetAppend(`'${LOG_TAB}'!A1`, [[
      now.iso, new Date().toISOString(), sent.join(", "), failed.join("; "),
    ]]);
  } catch { /* the log is a convenience; a failed append must not resend */ }

  return `standup text ${now.iso}: sent to ${sent.join(", ") || "nobody"}`
    + (failed.length ? ` | failed: ${failed.join("; ")}` : "");
}
