/**
 * SMS gateway to the Store Map — techs and admins text changes instead of
 * opening the app. Twilio posts every inbound SMS/MMS on the shop number
 * here; a small Claude call maps the free-text (ESL-friendly, no command
 * syntax) onto one of the Store Map bridge's existing write actions, the
 * bridge does the write exactly as if it were clicked in the app, and the
 * sender gets a confirmation text naming the piano.
 *
 *   "38930 update to phase 9"        → setphase (phase names or 1–13 numbers)
 *   "move 22722 to map 52"           → move
 *   "38930 queue 3"                  → queue
 *   <photo MMS> "38930 progress"     → photo (lands in the piano's Tech folder)
 *   <photo MMS> "38930 QC worksheet" → photo (same folder, note carried)
 *   "38930 before photos done"       → setmedia
 *   "38930 keys ivory ebony"         → setkeys
 *   "38930 cabinetry 8-3"            → setcabinetry
 *
 * Attribution: sender's number is matched against the Tech Phones tab —
 * writes are logged under "<Name> (SMS)". Unknown numbers are refused.
 * Conversational texts ("ok", "thanks") get no reply, so replies to the
 * cleaning/reminder texts don't trigger nonsense.
 *
 * Env (Netlify site settings):
 *   ANTHROPIC_API_KEY     — for the intent parse (Haiku; ~fractions of a cent/text)
 *   STOREMAP_TEAM_PIN     — the Store Map bridge team PIN (authorizes writes)
 *   TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN — already set (reminders use them);
 *     also used here to verify Twilio's signature and download MMS photos.
 */
import * as crypto from "node:crypto";

const REPORT_SHEET_ID = "11RoeVRETag5rZYX6_tEH-rf6x8JL0JeZU0P5AT0WI-I";
const PHONES_TAB = "Tech Phones";
const STORE_API = "https://blpstoremap.netlify.app/api/data";
const BRIDGE_URL =
  "https://script.google.com/macros/s/AKfycbxY4BKnr_Tr0iCTc9itCWhNYLvgszmkI1IoYSkbBWpyAqRtWI-yaUkJQjcVdgG58KXt/exec";
const MODEL = process.env.SMS_MODEL || "claude-haiku-4-5-20251001";
// only these people can set a sale price by text (first-name match on the
// Tech Phones name) — pricing is an owner decision
const PRICE_SETTERS = ["brigham", "karmel"];

const PHASES = ["New Arrival - Admin", "Assessment", "CAP", "PRSB & Plate Refinishing",
  "Lacquer Soundboard", "Restringing", "Chip Tuning", "DHRT", "1st Tuning", "Refinishing",
  "QC & Assembly", "2nd Tuning", "Exit Prep - Admin"];
const PHASE_STATES = ["In Queue", "Paused", "For Sale", "Waiting on Brigham",
  "Waiting on Curtis Harper", "Waiting on OTHER", "Delivered"];

/* ---------- Google Sheets read (same self-contained pattern as the reminders) ---------- */
let tokenCache: { token: string; exp: number } | null = null;
async function googleToken(): Promise<string> {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || "";
  const key = (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
  if (!email || !key) throw new Error("Google service account env not set");
  const now = Math.floor(Date.now() / 1000);
  if (tokenCache && tokenCache.exp > now + 60) return tokenCache.token;
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const header = b64({ alg: "RS256", typ: "JWT" });
  const claims = b64({ iss: email, scope: "https://www.googleapis.com/auth/spreadsheets.readonly",
    aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 });
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  const signature = signer.sign(key).toString("base64url");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${header}.${claims}.${signature}` }),
  });
  if (!res.ok) throw new Error(`token exchange ${res.status}`);
  const json = (await res.json()) as { access_token: string; expires_in: number };
  tokenCache = { token: json.access_token, exp: now + json.expires_in };
  return json.access_token;
}
async function techForNumber(from: string): Promise<string | null> {
  const token = await googleToken();
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${REPORT_SHEET_ID}/values/${encodeURIComponent(`'${PHONES_TAB}'!A2:C100`)}`,
    { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return null;
  const rows = ((await res.json()).values as string[][]) || [];
  const last10 = from.replace(/\D/g, "").slice(-10);
  for (const r of rows) {
    const cell = (r[1] || "").replace(/\D/g, "").slice(-10);
    if (cell && cell === last10) return (r[0] || "").trim();
  }
  return null;
}

/* ---------- Twilio signature check (X-Twilio-Signature, HMAC-SHA1) ---------- */
function validSignature(url: string, params: Record<string, string>, sig: string): boolean {
  const tok = process.env.TWILIO_AUTH_TOKEN || "";
  if (!tok || !sig) return false;
  const data = url + Object.keys(params).sort().map(k => k + params[k]).join("");
  const expect = crypto.createHmac("sha1", tok).update(Buffer.from(data, "utf-8")).digest("base64");
  try { return crypto.timingSafeEqual(Buffer.from(expect), Buffer.from(sig)); }
  catch { return false; }
}

/* ---------- helpers ---------- */
const twiml = (msg?: string) =>
  new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${
    msg ? `<Message>${msg.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</Message>` : ""}</Response>`,
    { headers: { "content-type": "text/xml" } });

type Piano = { row: number; serial: string; summary: string; location: string;
  phase: string; queuePos?: number; active: boolean; section: string };

async function bridge(body: Record<string, unknown>): Promise<any> {
  const r = await fetch(BRIDGE_URL, {
    method: "POST", redirect: "follow",
    headers: { "content-type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ pin: process.env.STOREMAP_TEAM_PIN || "", ...body }),
  });
  return r.json();
}

/* ---------- the handler ---------- */
export default async (req: Request) => {
  if (req.method !== "POST") return new Response("ok");
  const raw = await req.text();
  const params: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(raw)) params[k] = v;

  // Called two ways: forwarded internally by /api/twilio/inbound (the number's
  // real webhook - it owns lead replies), or directly by Twilio if the number
  // is ever re-pointed here. Internal forwards carry a shared-secret header.
  const internal = crypto.createHash("sha256")
    .update(process.env.TWILIO_AUTH_TOKEN || "").digest("hex");
  const isInternal = req.headers.get("x-internal-auth") === internal;
  const url = new URL(req.url);
  const publicUrl = `https://${url.host}${url.pathname}`;
  if (!isInternal && !validSignature(publicUrl, params, req.headers.get("x-twilio-signature") || "")) {
    return new Response("bad signature", { status: 403 });
  }

  const from = params.From || "";
  const body = (params.Body || "").trim();
  const nMedia = parseInt(params.NumMedia || "0", 10) || 0;

  const who = await techForNumber(from);
  if (!who) {
    // not a tech: hand the message back to the lead-reply pipeline
    return new Response("PASS", { headers: { "x-sms-pass": "1" } });
  }

  // conversational noise (replies to reminder texts) — stay silent
  if (!nMedia && (body.length < 4 || /^(ok|okay|thanks|thank you|got it|yes|no|k|sure)[.!]?$/i.test(body))) {
    return twiml();
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return twiml("The SMS gateway isn't fully set up yet (missing AI key) - use the Store Map app for now.");
  }

  // live piano list (slim) for grounding
  let pianos: Piano[] = [];
  try {
    const d = await (await fetch(STORE_API)).json();
    pianos = (d.pianos || []).filter((p: Piano) => p.active && p.serial);
  } catch { return twiml("Couldn't reach the Store Map right now - try again in a minute."); }
  const roster = pianos.map(p =>
    `${p.serial} | ${p.summary.slice(0, 38)} | map ${p.location} | ${p.phase || "-"}`).join("\n");

  // ---- intent parse ----
  const tools = [
    { name: "execute", description: "Apply one change to one piano via the Store Map bridge.",
      input_schema: { type: "object", properties: {
        action: { type: "string", enum: ["setphase", "move", "queue", "photo", "setmedia", "setkeys", "setcabinetry", "settrack", "setdone", "setprice"] },
        serial: { type: "string", description: "EXACT serial from the piano list" },
        phase: { type: "string", description: "for setphase: exact phase name from the lists" },
        location: { type: "string", description: "for move: the new map spot" },
        position: { type: "integer", description: "for queue: new queue position" },
        field: { type: "string", enum: ["bphoto", "bvideo", "aphoto", "avideo"], description: "for setmedia" },
        keys: { type: "string", description: "for setkeys: comma list from Ivory, Plastic, Ebony" },
        cabinetry: { type: "string", description: "for setcabinetry: shelf tokens like 8-3, 5-RF" },
        tracks: { type: "array", items: { type: "string" }, description: "for settrack: from Rebuild, Hybrid, Refurbish, Refinish, Technology, Old Player, Storage, Misc" },
        phases_done: { type: "array", items: { type: "string" }, description: "for setdone: FULL new list of completed phase names" },
        price: { type: "string", description: "for setprice: digits only, no $ or commas (e.g. 12995)" },
        note: { type: "string", description: "for photo: what the picture is (e.g. QC worksheet)" },
      }, required: ["action", "serial"] } },
    { name: "clarify", description: "Ask the sender one short question when the piano or intent is ambiguous.",
      input_schema: { type: "object", properties: { question: { type: "string" } }, required: ["question"] } },
    { name: "unsupported", description: "The request is understood but not doable by text yet.",
      input_schema: { type: "object", properties: { reply: { type: "string" } }, required: ["reply"] } },
  ];
  const sys = `You translate one SMS from a piano technician into one Store Map change. `
    + `Team members write shorthand and English is a second language for some - `
    + `"restring"="restringing", "phase 9"= the 9th numbered phase. `
    + `Numbered phases (1-13): ${PHASES.map((p, i) => `${i + 1}=${p}`).join("; ")}. `
    + `Also valid phases: ${PHASE_STATES.join(", ")}. `
    + `If a photo is attached, the action is almost always "photo". `
    + `Match pianos by serial when given; otherwise by make/model/map spot - `
    + `if more than one piano could match, use clarify and name the top candidates `
    + `(summary + serial). A bare price answer ("51889 12995", "$12,995 for the `
    + `Wurlitzer", or just "12995" right after a price request) is setprice - strip `
    + `$ and commas. For requests like tuning appointments, marking duplicates, or `
    + `anything not in the action list, use unsupported and point them to the Store `
    + `Map app's Request menu. Never guess a serial.`;
  const userMsg = `Sender: ${who}\nAttached photos: ${nMedia}\nMessage: ${body || "(no text)"}\n\nPiano list:\n${roster}`;
  let parsed: any;
  try {
    const ai = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": process.env.ANTHROPIC_API_KEY!, "anthropic-version": "2023-06-01",
        "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL, max_tokens: 400, system: sys,
        tools, tool_choice: { type: "any" },
        messages: [{ role: "user", content: userMsg }] }),
    });
    const aj = await ai.json();
    parsed = (aj.content || []).find((c: any) => c.type === "tool_use");
    if (!parsed) throw new Error(aj.error?.message || "no tool call");
  } catch (e) {
    return twiml("Sorry - couldn't understand that one. Try like: \"38930 phase 9\" or \"move 22722 to map 52\".");
  }

  if (parsed.name === "clarify") return twiml(parsed.input.question.slice(0, 300));
  if (parsed.name === "unsupported") return twiml(parsed.input.reply.slice(0, 300));

  const a = parsed.input;
  const piano = pianos.find(p => p.serial === a.serial);
  if (!piano) return twiml(`No active piano with serial ${a.serial} - double-check and resend.`);
  const label = `${piano.summary.slice(0, 40)} (#${piano.serial})`;
  const user = { name: `${who} (SMS)` };

  try {
    if (a.action === "photo") {
      if (!nMedia) return twiml(`Attach the photo to the same text and resend for ${label}.`);
      const sid = process.env.TWILIO_ACCOUNT_SID || "", tok = process.env.TWILIO_AUTH_TOKEN || "";
      let saved = 0, name = "";
      for (let i = 0; i < Math.min(nMedia, 5); i++) {
        const mu = params[`MediaUrl${i}`]; if (!mu) continue;
        const mr = await fetch(mu, { headers: { Authorization: "Basic " + Buffer.from(`${sid}:${tok}`).toString("base64") } });
        if (!mr.ok) continue;
        const buf = Buffer.from(await mr.arrayBuffer());
        if (buf.length > 4.5 * 1024 * 1024) continue;   // keep under Apps Script POST limits
        const j = await bridge({ action: "photo", serial: piano.serial, row: piano.row,
          stage: (a.note || "").slice(0, 60), mime: params[`MediaContentType${i}`] || "image/jpeg",
          data: buf.toString("base64"), user });
        if (j.saved) { saved++; name = j.name || ""; }
      }
      return twiml(saved
        ? `Saved ${saved} photo${saved > 1 ? "s" : ""} to the Tech folder for ${label}${name ? ` (${name})` : ""}.`
        : `Couldn't save the photo for ${label} - try the app's Add progress photo button.`);
    }
    if (a.action === "setphase") {
      const j = await bridge({ action: "setphase", serial: piano.serial, row: piano.row, phase: a.phase || "", user });
      if (j.error) throw new Error(j.error);
      return twiml(`Done - ${label} is now "${j.phase || a.phase}"${j.autoCompleted ? " and all shop phases were marked complete (For Sale)" : ""}.`);
    }
    if (a.action === "move") {
      const j = await bridge({ action: "move", serial: piano.serial, row: piano.row, newLocation: a.location || "", user });
      if (!j.moved) throw new Error(j.error || "move failed");
      let extra = j.bumped?.length ? ` (bumped ${j.bumped.map((b: any) => b.summary).join(", ")} to the attic)` : "";
      return twiml(`Done - ${label} moved from ${j.previous || "?"} to map ${j.location}${extra}.`);
    }
    if (a.action === "queue") {
      const j = await bridge({ action: "queue", serial: piano.serial, row: piano.row, position: a.position, user });
      if (j.error) throw new Error(j.error);
      return twiml(`Done - ${label} is queue #${a.position}.`);
    }
    if (a.action === "setmedia") {
      const j = await bridge({ action: "setmedia", serial: piano.serial, row: piano.row, field: a.field, user });
      if (j.error) throw new Error(j.error);
      return twiml(`Done - marked ${a.field} for ${label}.`);
    }
    if (a.action === "setkeys") {
      const j = await bridge({ action: "setkeys", serial: piano.serial, row: piano.row, keys: a.keys || "", user });
      if (j.error) throw new Error(j.error);
      return twiml(`Done - key service for ${label}: ${j.keys || a.keys}.`);
    }
    if (a.action === "setcabinetry") {
      const j = await bridge({ action: "setcabinetry", serial: piano.serial, row: piano.row, cabinetry: a.cabinetry || "", user });
      if (j.error) throw new Error(j.error);
      return twiml(`Done - cabinetry for ${label}: ${j.cabinetry || "(cleared)"}.`);
    }
    if (a.action === "settrack") {
      const j = await bridge({ action: "settrack", serial: piano.serial, row: piano.row, tracks: a.tracks || [], user });
      if (j.error) throw new Error(j.error);
      return twiml(`Done - track for ${label}: ${(a.tracks || []).join(", ") || "(cleared)"}.`);
    }
    // price answers by text (Brigham 8/27): a price request texts Brigham, he
    // replies with the number, it lands in the Piano Log and the price tag.
    // Pricing is an owner call — nobody else can set it from a phone.
    if (a.action === "setprice") {
      if (!PRICE_SETTERS.some(n => who.toLowerCase().startsWith(n))) {
        return twiml("Prices are set by Brigham - he gets the request and replies with the number.");
      }
      const digits = String(a.price || "").replace(/[^0-9.]/g, "");
      if (!digits) return twiml("What price? Reply with the serial and the number, e.g. \"51889 12995\".");
      const j = await bridge({ action: "setprice", serial: piano.serial, row: piano.row,
        price: digits, user });
      return twiml(j.ok
        ? `Priced ${piano.summary.slice(0, 28)} #${piano.serial} at ${j.price} - the tag updates automatically.`
        : `Couldn't set that price: ${j.error || "failed"}`);
    }
    if (a.action === "setdone") {
      const j = await bridge({ action: "setdone", serial: piano.serial, row: piano.row, phases: a.phases_done || [], user });
      if (j.error) throw new Error(j.error);
      return twiml(`Done - completed phases for ${label}: ${j.done || "(none)"}.`);
    }
    return twiml("That action isn't textable yet - use the Store Map app.");
  } catch (e: any) {
    return twiml(`Couldn't apply that to ${label}: ${String(e.message || e).slice(0, 120)}. Nothing was changed.`);
  }
};

export const config = { path: "/.netlify/functions/sms-inbound" };
