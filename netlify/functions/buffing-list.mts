/**
 * Store Map — KORBAN'S BUFFING LIST (Walter 10/7). One list for the two kinds
 * of hardware Korban buffs, so he no longer works from two spreadsheets:
 *
 *   PLATE SCREWS — the plates on Curtis Harper's work-orders sheet ("Requested"
 *     tab, Plates section) whose column N "Plate hardware complete (Korban)" is
 *     unchecked, in Curtis's priority order (column B).
 *   VISIBLE HARDWARE — every active piano past CAP (PRSB - Downbearing through
 *     Refinishing): CAP hands the visible hardware to Korban's queue. Furthest
 *     along first, since QC & Assembly is where it has to be back. A piano
 *     leaves the list when it is marked "Prepped for shipping" (sets the
 *     card's electroplating task to Submitted — one step, Walter 10/7),
 *     "Buffed" (No electroplating) or "Already done" (the one-time cleanup),
 *     or once the card's electroplating task already shows Submitted/Received.
 *
 *   GET  ?key=…  → {ok, today, plates:[…], hardware:[…]}
 *   POST {key, op, on, serial, by, auth?, …}
 *     op 'screws'  {curtisRow, pianoText, mapRow?, prevHw?} → ticks/unticks
 *                  column N on Curtis's sheet, sets the card's plate hardware
 *                  status to Buffed (or back to prevHw), records the tap
 *     op 'prepped' → the card's electroplating task step 1 "Submitted"
 *     op 'buffed' | 'done' → buffing-list task "Buffed" / "Already done"
 *   Every tap can be undone with on:false. Taps from today come back in GET
 *   with done set, so the page can offer undo for the rest of the day.
 *
 * Writes go through the existing paths: piano-tasks (Task Status tab of the
 * Piano Log) and the durable relay (plate hardware status), so the card shows
 * exactly what the page did.
 */
import * as crypto from "node:crypto";

const CURTIS_ID = "1DxvDQ9WlhxXfiZaKGpdJLOOPNMBfVA9PsHGuLe55pmc";
const PIANO_LOG_ID = "1ZunbPKygpQlcXfTyPowDHdUE9spJ3uV1XA4iX1eoKRc";
const DATA_URL = "https://blpstoremap.netlify.app/.netlify/functions/data";
const TASKS_URL = "https://blpsalesapp.netlify.app/.netlify/functions/piano-tasks";
const RELAY_URL = "https://blpsalesapp.netlify.app/.netlify/functions/pianolog-write";
const ALLOW = ["https://blpstoremap.netlify.app", "http://localhost:8641"];

export const PLATING_TASK = "pedals/cabinetry hardware electroplating and polishing";
export const HW_TASK = "visible hardware (buffing list)";
export const SCREW_TASK = "plate screws (buffing list)";
const PHASES = ["New Arrival - Admin", "Assessment", "CAP", "PRSB - Downbearing",
  "PRSB - Notching and Pins", "Lacquer Soundboard", "Restringing", "Chip Tuning", "DHRT",
  "1st Tuning", "Refinishing", "QC & Assembly", "2nd Tuning", "Exit Prep - Admin"];
const RETIRED: Record<string, string> = {
  "PRSBa - Pre-Plate": "PRSB - Downbearing", "PRSBb - Plate In": "PRSB - Notching and Pins" };
const FIRST = PHASES.indexOf("PRSB - Downbearing"), LAST = PHASES.indexOf("Refinishing");

let tokenCache: { token: string; exp: number } | null = null;
async function googleToken(): Promise<string> {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || "";
  const key = (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
  if (!email || !key) throw new Error("Google service account env not set");
  const now = Math.floor(Date.now() / 1000);
  if (tokenCache && tokenCache.exp > now + 60) return tokenCache.token;
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const header = b64({ alg: "RS256", typ: "JWT" });
  const claims = b64({ iss: email, scope: "https://www.googleapis.com/auth/spreadsheets",
    aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 });
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  const signature = signer.sign(key).toString("base64url");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${header}.${claims}.${signature}` }),
  });
  if (!res.ok) throw new Error(`Google token exchange failed (${res.status})`);
  const j = (await res.json()) as { access_token: string; expires_in: number };
  tokenCache = { token: j.access_token, exp: now + j.expires_in };
  return j.access_token;
}
async function sheets(id: string, path: string, init?: RequestInit): Promise<any> {
  const t = await googleToken();
  const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}${path}`, {
    ...init, headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json", ...init?.headers } });
  const j = await r.json();
  if (!r.ok) throw new Error(j?.error?.message || `HTTP ${r.status}`);
  return j;
}

const norm = (s: unknown) => String(s ?? "").trim().toLowerCase();
const denverDay = () => new Date().toLocaleDateString("en-US", { timeZone: "America/Denver" });   // "10/7/2026"
const stampedToday = (stamp: unknown) => String(stamp || "").startsWith(denverDay() + " ");
// the serial in Curtis's free-text piano cell: "Schaeffer 23910", "Steinway #154950"
const serialIn = (txt: string) => { const m = /#?\b([A-Z]?\d{3,})\b(?!.*\b[A-Z]?\d{3,}\b)/i.exec(txt || ""); return m ? m[1] : ""; };

type TaskRow = { serial: string; task: string; part: string; step1: string; step1At: string; step2: string; step2At: string };
async function taskRows(): Promise<TaskRow[]> {
  const out = await sheets(PIANO_LOG_ID, `/values/${encodeURIComponent("'Task Status'!A2:H4000")}`);
  return ((out.values || []) as string[][]).map(r => ({ serial: (r[0] || "").trim(), task: (r[1] || "").trim(),
    part: (r[2] || "").trim(), step1: (r[3] || "").trim(), step1At: (r[4] || "").trim(),
    step2: (r[5] || "").trim(), step2At: (r[6] || "").trim() }));
}
async function curtisRows(): Promise<string[][]> {
  const out = await sheets(CURTIS_ID, `/values/${encodeURIComponent("'Requested'!A1:N80")}?valueRenderOption=FORMATTED_VALUE`);
  return (out.values || []) as string[][];
}
async function mapPianos(): Promise<any[]> {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(DATA_URL + "?nc=" + Date.now());
      const j = await r.json();
      if (Array.isArray(j.pianos)) return j.pianos;
    } catch { /* cold instance / HTML — retry */ }
  }
  throw new Error("map data unavailable");
}

export async function buildLists() {
  const [curtis, tasks, pianos] = await Promise.all([curtisRows(), taskRows(), mapPianos()]);
  const active = pianos.filter(p => p.active && !p.archived);
  const bySerial = new Map<string, any>();
  active.forEach(p => { if (p.serial) bySerial.set(norm(p.serial), p); });
  // for-sale and sold pianos are off Korban's list (Walter 10/7): phase For
  // Sale or Sold, or "For Sale" / "Sold" in the Piano Log STATUS column
  const forSale = (p: any) => !!p && (/^(for sale|sold)$/i.test(String(p.phase || "").trim())
    || /\b(for sale|sold)\b/i.test(String(p.status || "")));
  // pianos in 1st Tuning are off the list too (Walter 10/7)
  const skipPhase = (p: any) => !!p && /^1st tuning$/i.test(String(p.phase || "").trim());
  const task = (serial: string, name: string) =>
    tasks.find(t => norm(t.serial) === norm(serial) && norm(t.task) === norm(name) && !t.part);

  // ---- plate screws: Plates section of Curtis's Requested tab ----
  const plates: any[] = [];
  for (let i = 1; i < curtis.length; i++) {
    const r = curtis[i] || [];
    const a = String(r[0] || "");
    if (/^-{3,}\s*plates\s*-{3,}/i.test(a.trim())) continue;   // the section's own banner (row 2)
    if (/small\/medium|in store|^-{3,}/i.test(a.trim())) break;   // next section — end of the Plates list
    const pianoText = String(r[4] || "").trim();
    if (!pianoText) continue;
    const checked = /^true$/i.test(String(r[13] || "").trim());
    const serial = serialIn(pianoText);
    const st = serial ? task(serial, SCREW_TASK) : undefined;
    const doneToday = checked && !!st && stampedToday(st.step2At);
    if (checked && !doneToday) continue;
    const p = serial ? bySerial.get(norm(serial)) : null;
    if (forSale(p) || skipPhase(p)) continue;
    plates.push({ curtisRow: i + 1, priority: Number(r[1]) || null, pianoText, serial,
      requested: String(r[2] || ""), curtisNote: String(r[6] || ""),
      mapRow: p ? p.row : null, phase: p ? p.phase || "" : "", plateHw: p ? p.plateHwStatus || "" : "",
      done: doneToday ? (st!.step2At.split("·")[1] || "").trim() || "done" : "" });
  }
  plates.sort((x, y) => (x.priority ?? 999) - (y.priority ?? 999));

  // ---- visible hardware: pianos past CAP, not yet shipped / buffed / done ----
  const hardware: any[] = [];
  for (const p of active) {
    const ph = RETIRED[p.phase] || p.phase || "";
    const idx = PHASES.indexOf(ph);
    if (idx < FIRST || idx > LAST || !p.serial || forSale(p) || skipPhase(p)) continue;
    const plating = task(p.serial, PLATING_TASK);
    const own = task(p.serial, HW_TASK);
    const sent = plating && (plating.step1At || plating.step2At);
    const ownDone = own && own.step2At;
    let done = "";
    if (sent) { if (plating!.step1At && stampedToday(plating!.step1At)) done = "Prepped for shipping"; else continue; }
    // "Already done" leaves the list at once (Mark 10/7, one-time cleanup) — only
    // Buffed stays visible for the day with its undo
    else if (ownDone) { if (stampedToday(own!.step2At) && !/^already done$/i.test(own!.step2)) done = own!.step2 || "Done"; else continue; }
    const finish = String(p.plateFinish || "").trim();
    hardware.push({ serial: p.serial, mapRow: p.row, phase: ph, phaseIdx: idx,
      // manufacturer and serial are all Korban needs (Walter 10/7)
      label: [String(p.make || "").trim() || String(p.summary || "").split("/")[0].trim(), "#" + p.serial].filter(Boolean).join(" "),
      summary: String(p.summary || "").slice(0, 80), finish,
      kind: /^no electroplating$/i.test(finish) ? "buff" : finish ? "ship" : "unset", done });
  }
  hardware.sort((x, y) => y.phaseIdx - x.phaseIdx || x.label.localeCompare(y.label));
  return { ok: true, today: denverDay(), plates, hardware };
}

const LINK = "https://blpstoremap.netlify.app/#report=buffing";

export async function buffingText(): Promise<string> {
  const L = await buildLists();
  const plates = L.plates.filter((p: any) => !p.done);
  const hw = L.hardware.filter((h: any) => !h.done);
  if (!plates.length && !hw.length) return "";
  const day = new Date().toLocaleDateString("en-US", { timeZone: "America/Denver", weekday: "short", month: "numeric", day: "numeric" });
  const lines = [`🔧 Korban — buffing priorities, ${day}`];
  if (plates.length) {
    lines.push("Plate screws:");
    plates.slice(0, 3).forEach((p: any, i: number) => lines.push(`${i + 1}. ${p.pianoText}`));
    if (plates.length > 3) lines.push(`+${plates.length - 3} more`);
  }
  if (hw.length) {
    lines.push("Visible hardware to prep:");
    hw.slice(0, 3).forEach((h: any, i: number) => lines.push(`${i + 1}. ${h.label} — ${
      h.kind === "buff" ? "buff only" : h.kind === "ship" ? h.finish : "finish not set"}`));
    if (hw.length > 3) lines.push(`+${hw.length - 3} more`);
  }
  lines.push(`Done one? Tap it: ${LINK}`);
  return lines.join("\n");
}


function cors(origin: string | null) {
  const o = origin && ALLOW.includes(origin) ? origin : ALLOW[0];
  return { "access-control-allow-origin": o, "access-control-allow-headers": "content-type",
    "access-control-allow-methods": "GET,POST,OPTIONS", "content-type": "application/json" };
}
const keyOk = (k: unknown) => {
  const app = process.env.BLP_APP_ACCESS_KEY || "";
  return (!!app && k === app) || String(k || "").trim().toLowerCase() === "pianoman";
};
async function setTask(serial: string, task: string, step: 1 | 2, label: string, on: boolean, by: string) {
  const r = await fetch(TASKS_URL, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ key: process.env.BLP_APP_ACCESS_KEY || "pianoman", serial, task, part: "", step, label, on, by }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !(j as any).ok) throw new Error((j as any).error || "task save failed " + r.status);
}

export default async (req: Request) => {
  const headers = cors(req.headers.get("origin"));
  const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers });
  if (req.method === "OPTIONS") return new Response("", { headers });
  try {
    if (req.method === "GET") {
      const u = new URL(req.url);
      if (!keyOk(u.searchParams.get("key"))) return json({ error: "unauthorized" }, 401);
      // ?text=1 previews Korban's morning text without sending anything
      if (u.searchParams.get("text") === "1") return json({ ok: true, text: await buffingText() });
      return json(await buildLists());
    }
    if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
    const b = (await req.json()) as Record<string, any>;
    if (!keyOk(b.key)) return json({ error: "unauthorized" }, 401);
    const op = String(b.op || ""), on = b.on !== false;
    const serial = String(b.serial || "").trim();
    const by = String(b.by || "").trim().slice(0, 40) || "Team";

    if (op === "screws") {
      const row = Number(b.curtisRow);
      if (!(row >= 2 && row <= 80)) return json({ error: "bad Curtis row" }, 400);
      // the sheet is edited by hand — make sure the row still holds this plate
      const cur = await sheets(CURTIS_ID, `/values/${encodeURIComponent(`'Requested'!E${row}`)}`);
      const now = String(cur.values?.[0]?.[0] || "").trim();
      if (norm(now) !== norm(b.pianoText)) {
        return json({ error: `Curtis's sheet changed (row ${row} now reads "${now.slice(0, 40)}") — reload the list` }, 409);
      }
      await sheets(CURTIS_ID, `/values/${encodeURIComponent(`'Requested'!N${row}`)}?valueInputOption=USER_ENTERED`,
        { method: "PUT", body: JSON.stringify({ values: [[on ? "TRUE" : "FALSE"]] }) });
      const notes: string[] = ["Curtis's sheet " + (on ? "ticked" : "unticked")];
      if (serial) {
        try { await setTask(serial, SCREW_TASK, 2, "Done", on, by); } catch (e) { notes.push("tap not recorded: " + String((e as Error).message).slice(0, 60)); }
        // undo only restores the card when the page knows what it was before
        if (b.mapRow && (on || b.prevHw != null)) {
          // card's plate hardware status, through the durable relay like the card itself
          const auth = (b.auth && typeof b.auth === "object") ? b.auth : {};
          const r = await fetch(RELAY_URL, { method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify({ relayKey: process.env.BLP_APP_ACCESS_KEY || "", pin: "pianoman", action: "setplatehw",
              serial, row: Number(b.mapRow), plateHwStatus: on ? "Buffed" : String(b.prevHw || ""), ...auth }) });
          const j = await r.json().catch(() => ({}));
          notes.push((j as any).ok || (j as any).queued ? "card " + (on ? "set to Buffed" : "restored") : "card not updated");
        }
      }
      return json({ ok: true, notes });
    }
    if (!serial) return json({ error: "serial required" }, 400);
    if (op === "prepped" || op === "shipped") { await setTask(serial, PLATING_TASK, 1, "Submitted", on, by); return json({ ok: true }); }
    if (op === "buffed") { await setTask(serial, HW_TASK, 2, "Buffed", on, by); return json({ ok: true }); }
    if (op === "done") { await setTask(serial, HW_TASK, 2, "Already done", on, by); return json({ ok: true }); }
    return json({ error: "unknown op" }, 400);
  } catch (e) {
    return json({ error: String((e as Error).message || e).slice(0, 200) }, 500);
  }
};
