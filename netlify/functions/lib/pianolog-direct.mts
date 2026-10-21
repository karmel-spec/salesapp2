/**
 * Piano Log — DIRECT SHEET WRITES through the Sheets API (step 2, 10/14).
 *
 * Why: every Store Map write used to go through the Apps Script bridge, which
 * costs 5–30 s per call (3–5 s of it Google queueing before the script even
 * runs). Measured Oct 9–13: 0 of 40 writes confirmed inside the relay's 8 s
 * budget. The Sales Console never had that problem because it writes its
 * sheet straight through the Sheets API with the service account, in about a
 * second — this module gives the Piano Log the same path.
 *
 * What it does: for the plain cell-setting actions the Store Map relays
 * (phase, location, plate / keytop / cabinetry fields, notes, flags) it
 * resolves the row BY SERIAL exactly as the bridge's findPiano_ does, writes
 * the same cells the bridge writes (same headers, same value rules, same
 * side columns), appends the same ACTIVITY LOG line, and returns the same
 * result shape — so the map, the mirror patch and the activity report cannot
 * tell the difference, except that it took ~1 s.
 *
 * What it does NOT do (returns null → the caller uses the bridge, unchanged):
 *   - Delivered (moves the row below the SOLD divider; Walter's verified path)
 *   - Exit Prep - Admin (texts admin via the bridge's notifyTeam_)
 *   - anything that needs a header column CREATED (the bridge adds columns on
 *     demand; here a missing header is the bridge's job)
 *   - setprice / setkeys / setdone / setmedia / settype / setsnooze /
 *     unmarkduplicate / tempresolve — low volume, extra rules; bridge
 *   - a caller the bridge would have to authenticate itself (a PIN other than
 *     the team alias and no verifiable Google token)
 *
 * The sheet stays the authority (decision 10/7). The bridge keeps its own
 * copy of every rule below; when one changes there, change it here too —
 * the constants are copied from apps-script/DailyReport.gs and labelled.
 *
 * Race with the Piano Log app's bridge (open item 3 from 10/7): a row read
 * here and a moveRows there can interleave. The window is the ~150 ms between
 * the row read and the write (the bridge's own window was seconds); the
 * serial is checked in the same read as the row, and re-read right after the
 * write — if it moved, the caller is told to refresh and the activity log
 * records it, so nothing is silently wrong.
 */
import { googleToken } from "../_blp-sched-lib.mts";

export const PIANO_LOG_ID = "1ZunbPKygpQlcXfTyPowDHdUE9spJ3uV1XA4iX1eoKRc";
const TAB = "Piano Log";
const LOG_TAB = "ACTIVITY LOG";
const API = `https://sheets.googleapis.com/v4/spreadsheets/${PIANO_LOG_ID}`;
const MAX_ROWS = 6000;
const LOC_COL = 21;   // U — LOCATION / STATUS, fixed in the bridge too
const TZ = "America/Denver";

/* ---------- copied from apps-script/DailyReport.gs (keep in step) ---------- */
export const PHASE_VALUES = ["New Arrival - Admin", "Assessment", "CAP",
  "PRSB - Downbearing", "PRSB - Notching and Pins",
  "Lacquer Soundboard", "Restringing",
  "Chip Tuning", "DHRT", "1st Tuning", "Refinishing", "QC & Assembly",
  "2nd Tuning", "Exit Prep - Admin", "Delivered",
  "In Queue", "Paused", "Player Piano Work", "For Sale", "Sale Pending", "Sold", "Post Sale QC",
  "Waiting on Brigham", "Waiting on Curtis Harper", "Waiting on Customer", "Waiting on OTHER",
  "Key Service", "Refurb Checklist", "Repair Work", "Add-ons",
  "Cabinetry Cleaning and Prep", "Action Problems and Hammer Prep", "Action Lubrication and Alignment", "Regulation"];
const PHASE_MIGRATE: Record<string, string> = {
  "New Arrival": "New Arrival - Admin", "Teardown": "CAP", "PRSB": "PRSB - Downbearing",
  "PRSB & Plate Refinishing": "PRSB - Downbearing", "PRSBa - Pre-Plate": "PRSB - Downbearing",
  "PRSBb - Plate In": "PRSB - Notching and Pins", "Final Assembly": "QC & Assembly",
  "Tuning": "1st Tuning", "QC": "QC & Assembly", "Admin Exit Prep": "Exit Prep - Admin",
};
const CARD_FIELDS: Record<string, { header: string; values: string[]; label: string }> = {
  plateFinish: { header: "PLATE HARDWARE FINISH", values: ["", "Brass", "Nickel", "Copper", "No electroplating"], label: "Plate hardware finish" },
  keytopMaterial: { header: "KEYTOP MATERIAL", values: ["", "White Acrylic", "Off-white Acrylic", "Ivory - clean & leave as is", "Ivory - replace damaged keys", "Ivory", "No key service"], label: "Keytop material" },
};
// mirrors the bridge's PLATE_HW_STATUSES ('' = not tracked)
const PLATE_HW_STATUSES = ["", "Needs buffing", "In buffing queue", "Buffing", "Buffed", "Installed"];
const PLATE_STATUSES = ["", "In piano", "Removed", "Plate storage — BEFORE", "At Curtis Harper", "Plate storage — AFTER", "Back in piano"];
const KEYTOP_STATES = ["Evaluate", "In Key Queue", "In Progress", "Done"];
const TRACK_VALUES = ["Rebuild", "Hybrid", "Refurbish", "Refinish", "Technology", "Old Player", "Storage", "Misc"];
const GOOGLE_CLIENT_ID = "110628682621-v65mkaoanv87sp75ggdfcrglfr7bkr8p.apps.googleusercontent.com";
const TEAM_EMAILS = ["brighamlarson@gmail.com"];
/* ------------------------------------------------------------------------- */

export type Payload = Record<string, unknown>;
export type DirectResult = Record<string, unknown> & { ok?: boolean; error?: string };

const s = (v: unknown) => (v == null ? "" : String(v));
const colA1 = (n: number) => { let x = ""; while (n > 0) { const m = (n - 1) % 26; x = String.fromCharCode(65 + m) + x; n = Math.floor((n - 1) / 26); } return x; };
const cell = (row: number, col: number) => `'${TAB}'!${colA1(col)}${row}`;

/* ---------- Sheets API ---------- */
async function api(path: string, init: RequestInit, timeoutMs: number): Promise<unknown> {
  const tok = await googleToken();
  const r = await fetch(API + path, {
    ...init,
    headers: { Authorization: "Bearer " + tok, "Content-Type": "application/json", ...(init.headers || {}) },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const txt = await r.text();
  if (!r.ok) throw new Error(`sheets ${r.status}: ${txt.slice(0, 160)}`);
  return txt ? JSON.parse(txt) : null;
}
async function batchGet(ranges: string[], timeoutMs = 6000): Promise<string[][][]> {
  const qs = ranges.map(x => "ranges=" + encodeURIComponent(x)).join("&") + "&majorDimension=ROWS";
  const j = (await api(`/values:batchGet?${qs}`, { method: "GET" }, timeoutMs)) as { valueRanges?: Array<{ values?: string[][] }> };
  return (j.valueRanges || []).map(v => v.values || []);
}
async function batchWrite(data: Array<{ range: string; values: unknown[][] }>, timeoutMs = 6000): Promise<void> {
  if (!data.length) return;
  // RAW = exactly what Range.setValue(string) stores: no formula / date parsing
  await api(`/values:batchUpdate`, { method: "POST", body: JSON.stringify({ valueInputOption: "RAW", data }) }, timeoutMs);
}

/* ---------- the row ---------- */
type Sheet = { hdr: string[]; owners: string[]; serials: string[]; summaries: string[]; locs: string[]; soldRow: number };

async function readSheet(): Promise<Sheet> {
  const [hdr, bcd, u] = await batchGet([`'${TAB}'!A2:ZZ2`, `'${TAB}'!B1:D${MAX_ROWS}`, `'${TAB}'!U1:U${MAX_ROWS}`]);
  const owners: string[] = [], serials: string[] = [], summaries: string[] = [];
  for (let i = 0; i < bcd.length; i++) { owners.push(s(bcd[i]?.[0])); serials.push(s(bcd[i]?.[1])); summaries.push(s(bcd[i]?.[2])); }
  const locs = u.map(r => s(r?.[0]));
  // the SOLD divider: owner cell "SOLD" with no serial (bridge: findPiano_ / soldDividerRow_)
  let soldRow = bcd.length + 1;
  for (let i = 0; i < bcd.length; i++) {
    if (owners[i].trim().toUpperCase() === "SOLD" && !serials[i].trim()) { soldRow = i + 1; break; }
  }
  return { hdr: (hdr[0] || []).map(s), owners, serials, summaries, locs, soldRow };
}

/** 1-based column of a header (row 2), or 0 when the sheet has no such column. */
function col(sh: Sheet, header: string): number {
  const want = header.toUpperCase();
  for (let c = 0; c < sh.hdr.length; c++) if (sh.hdr[c].trim().toUpperCase() === want) return c + 1;
  return 0;
}

/** Bridge findPiano_: the serial above the SOLD section; the client's row only when it really holds this serial. */
function findRow(sh: Sheet, serial: unknown, rowOverride: unknown): { row?: number; matches: number[]; error?: string } {
  const want = s(serial).trim().toLowerCase();
  if (!want) return { matches: [], error: "serial required" };
  const matches: number[] = [];
  for (let r = 1; r < sh.soldRow; r++) if ((sh.serials[r - 1] || "").trim().toLowerCase() === want) matches.push(r);
  if (!matches.length) return { matches, error: "serial not found above the SOLD section" };
  const ro = Number(rowOverride);
  const row = ro >= 1 && ro <= sh.serials.length && (sh.serials[ro - 1] || "").trim().toLowerCase() === want ? ro : matches[0];
  return { row, matches };
}

/* ---------- who (bridge: verifyGoogle_ / who_) ---------- */
const tokCache = new Map<string, { email: string; name: string; exp: number }>();
async function verifyGoogle(tok: unknown): Promise<{ email: string; name: string } | null> {
  if (!tok || typeof tok !== "string") return null;
  const hit = tokCache.get(tok);
  if (hit && hit.exp * 1000 > Date.now()) return { email: hit.email, name: hit.name };
  try {
    const r = await fetch("https://oauth2.googleapis.com/tokeninfo?id_token=" + encodeURIComponent(tok), { signal: AbortSignal.timeout(4000) });
    if (!r.ok) return null;
    const j = (await r.json()) as { aud?: string; exp?: string; email?: string; name?: string };
    if (j.aud !== GOOGLE_CLIENT_ID) return null;
    if (Number(j.exp) * 1000 < Date.now()) return null;
    const g = { email: j.email || "", name: j.name || "", exp: Number(j.exp) };
    if (tokCache.size > 200) tokCache.clear();
    tokCache.set(tok, g);
    return { email: g.email, name: g.name };
  } catch { return null; }
}
function teamEmail(email: string): boolean {
  const e = email.toLowerCase();
  return /@brighamlarsonpianos\.com$/.test(e) || /\.blp@gmail\.com$/.test(e) || TEAM_EMAILS.includes(e);
}
/** The bridge's three ways in, minus the Script-Properties TEAM_PIN (null = let the bridge decide). */
async function whoFor(p: Payload): Promise<{ who: string; g: { email: string; name: string } | null } | null> {
  const g = await verifyGoogle(p.idToken);
  const gOk = !!(g && g.email && teamEmail(g.email));
  const pinOk = s(p.pin).trim().toLowerCase() === "pianoman";
  if (!gOk && !pinOk) return null;
  if (g) return { who: (g.name || g.email) + (g.email ? " <" + g.email + ">" : ""), g };
  const u = (p.user || {}) as { name?: unknown; email?: unknown };
  if (u && (u.name || u.email)) return { who: s(u.name || u.email).slice(0, 60) + " (session expired — unverified)", g: null };
  return { who: "Team (PIN)", g: null };
}

/* ---------- activity log (bridge: logAct_) ---------- */
function denverStamp(d = new Date()): string {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: TZ, year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit", hour12: false });
  const o: Record<string, string> = {};
  for (const x of f.formatToParts(d)) o[x.type] = x.value;
  return `${o.month}/${o.day}/${o.year} ${o.hour === "24" ? "00" : o.hour}:${o.minute}:${o.second}`;
}
function denverShort(d = new Date()): string {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: TZ, month: "numeric", day: "numeric" });
  return f.format(d);
}
async function logAct(lines: Array<[string, string, string, string]>): Promise<void> {
  if (!lines.length) return;
  try {
    // USER_ENTERED so the stamp becomes a real date-time like appendRow(new Date())
    await api(`/values/${encodeURIComponent(`'${LOG_TAB}'!A1:E`)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
      { method: "POST", body: JSON.stringify({ values: lines.map(l => [denverStamp(), l[0], l[1], l[2], l[3]]) }) }, 5000);
  } catch (e) { console.warn("pianolog-direct: activity log append failed:", String((e as Error).message || e).slice(0, 120)); }
}

/* ---------- the write plan ---------- */
type Plan = {
  writes: Array<{ col: number; value: string }>;
  logs: Array<[string, string, string, string]>;   // who, action, piano, detail
  result: DirectResult;
};

/** addPianoNote_: a dated "M/d name: text" line prepended to PIANO NOTES. Returns the write, or null when the column is missing. */
function noteWrite(sh: Sheet, row: string[], who: string, text: string): { col: number; value: string } | null {
  const c = col(sh, "PIANO NOTES");
  if (!c) return null;
  const name = who.replace(/\s*<[^>]*>\s*/, "").replace(/\s*\(.*\)\s*$/, "");
  const line = denverShort() + " " + (name || "team") + ": " + text;
  const prev = s(row[c - 1]).trim();
  return { col: c, value: prev ? line + "\n" + prev : line };
}

function plan(action: string, p: Payload, sh: Sheet, rowNum: number, row: string[], who: string, g: { email: string; name: string } | null): Plan | null {
  const summary = s(row[3]);
  const piano = summary || s(p.serial);
  const cur = (c: number) => s(row[c - 1]);
  const need = (header: string) => col(sh, header);   // 0 → bridge creates it
  const base = { ok: true, row: rowNum, summary };
  switch (action) {
    case "setcardfield": {
      const def = CARD_FIELDS[s(p.field)];
      if (!def) return { writes: [], logs: [], result: { error: "unknown card field" } };
      const val = s(p.value).trim();
      if (!def.values.includes(val)) return { writes: [], logs: [], result: { error: "bad " + def.label + ": " + val } };
      const c = need(def.header); if (!c) return null;
      return { writes: [{ col: c, value: val }], logs: [[who, def.label, piano, val || "(cleared)"]],
        result: { ...base, field: s(p.field), value: val, label: def.label } };
    }
    case "setplatestatus": {
      const val = s(p.plateStatus).trim();
      if (!PLATE_STATUSES.includes(val)) return { writes: [], logs: [], result: { error: "bad plate status: " + val } };
      const c = need("PLATE STATUS"); if (!c) return null;
      const writes = [{ col: c, value: val }];
      const logs: Plan["logs"] = [[who, "Plate status", piano, val || "(cleared)"]];
      const result: DirectResult = { ...base, plateStatus: val };
      // Back in piano / In piano / At Curtis Harper ⇒ the plate left storage:
      // free its rack slat(s) on CABINETRY and clear PLATE TEMP SPOT (Walter 9/28, 10/13)
      if (val === "Back in piano" || val === "In piano" || val === "At Curtis Harper") {
        const freed: string[] = []; let tempCleared = false;
        const cabCol = col(sh, "CABINETRY"), tmpCol = col(sh, "PLATE TEMP SPOT");
        if (cabCol) {
          const toks = cur(cabCol).split(",").map(t => t.trim()).filter(Boolean);
          const keep = toks.filter(t => { if (/^\d+p$/i.test(t)) { freed.push(t.toUpperCase()); return false; } return true; });
          if (freed.length) writes.push({ col: cabCol, value: keep.join(", ") });
        }
        if (tmpCol && cur(tmpCol).trim()) { writes.push({ col: tmpCol, value: "" }); tempCleared = true; }
        if (freed.length || tempCleared) {
          result.freedSlats = freed; result.tempCleared = tempCleared;
          logs.push([s((g && (g.name || g.email)) || p.who || "Store Map"), "Plate storage freed", piano,
            (freed.length ? "slat " + freed.join(", ") : "") + (freed.length && tempCleared ? " + " : "") + (tempCleared ? "temp spot" : "")
            + (val === "At Curtis Harper" ? " — plate went to Curtis Harper" : " — plate back in piano")]);
        }
      }
      return { writes, logs, result };
    }
    case "setcabinetry": {
      const c = need("CABINETRY"); if (!c) return null;
      const val = s(p.cabinetry).trim();
      return { writes: [{ col: c, value: val }], logs: [[who, "Cabinetry location", piano, val || "(cleared)"]], result: { ...base, cabinetry: val } };
    }
    case "setplatehw": {
      // ONE action name, two card fields (Walter 10/16): the Plate hardware
      // STATUS dropdown sends plateHwStatus, the hardware LOCATION box sends
      // value. Treating every setplatehw as a location wiped the location and
      // dropped the status (Wick 29908 / Steinway 160095 "Buffed", 10/16).
      if (p.plateHwStatus != null) {
        const val = s(p.plateHwStatus).trim();
        if (!PLATE_HW_STATUSES.includes(val)) return { writes: [], logs: [], result: { error: "bad plate hardware status: " + val } };
        const c = need("PLATE HARDWARE STATUS"); if (!c) return null;
        return { writes: [{ col: c, value: val }], logs: [[who, "Plate hardware", piano, val || "(cleared)"]], result: { ...base, plateHwStatus: val } };
      }
      const c = need("PLATE HW LOCATION"); if (!c) return null;
      const val = s(p.value).trim().slice(0, 80);
      return { writes: [{ col: c, value: val }], logs: [[who, "Plate hardware location", piano, val || "(cleared)"]], result: { ...base, plateHw: val } };
    }
    case "setplatetemp": {
      const c = need("PLATE TEMP SPOT"); if (!c) return null;
      const val = s(p.value).trim().slice(0, 90);
      return { writes: [{ col: c, value: val }], logs: [[who, "Plate temp spot", piano, val || "(cleared)"]], result: { ...base, plateTemp: val } };
    }
    case "setadminsteps": {
      const c = need("ADMIN STEPS"); if (!c) return null;
      const val = s(p.steps).trim();
      return { writes: [{ col: c, value: val }], logs: [[who, "Admin steps", piano, val || "(cleared)"]], result: { ...base, steps: val } };
    }
    case "setpayplan": {
      const c = need("PAYMENT PLAN"); if (!c) return null;
      const val = s(p.plan).trim();
      return { writes: [{ col: c, value: val }], logs: [[who, "Payment plan", piano, val || "(cleared)"]], result: { ...base, plan: val } };
    }
    case "setkeystatus": {
      const val = s(p.value).trim().slice(0, 40);
      if (val && !KEYTOP_STATES.some(k => val === k || val.indexOf(k + " #") === 0)) return { writes: [], logs: [], result: { error: "bad keytop status: " + val } };
      const c = need("KEYTOP STATUS"); if (!c) return null;
      return { writes: [{ col: c, value: val }], logs: [[who, "Keytop status", piano, val || "(cleared)"]], result: { ...base, keytopStatus: val } };
    }
    case "setclientreports": {
      const c = need("CLIENT REPORTS"); if (!c) return null;
      const val = p.enabled ? "Yes" : "No";
      return { writes: [{ col: c, value: val }], logs: [[who, "Client reports " + (p.enabled ? "ON" : "OFF"), piano, ""]], result: { ...base, clientReports: val } };
    }
    case "setimportant": {
      const c = need("IMPORTANT NOTES"); if (!c) return null;
      const val = s(p.value).trim().slice(0, 200);
      return { writes: [{ col: c, value: val }], logs: [[who, "Important note", piano, val || "(cleared)"]], result: { ...base, importantNote: val } };
    }
    case "setbenchnote": {
      const c = need("BENCH NOTE"); if (!c) return null;
      const val = s(p.value).trim().slice(0, 160);
      const prevVal = cur(c).trim();
      const writes = [{ col: c, value: val }];
      if (val && val !== prevVal) { const n = noteWrite(sh, row, who, "Bench tag: " + val); if (!n) return null; writes.push(n); }
      return { writes, logs: [[who, "Bench tag note", piano, val || "(cleared)"]], result: { ...base, benchNote: val } };
    }
    case "setscopenote": {
      const c = need("SCOPE NOTES"); if (!c) return null;
      const val = s(p.value).trim().slice(0, 4000); // 4000 (10/21) — same as the bridge
      const writes = [{ col: c, value: val }];
      // only the typed part goes into 📝 Notes — pinned 📜 contract / 🏆 handoff lines ride along on every save
      const typed = val.split("\n").filter((l) => !/^\s*(📜|🏆)/u.test(l)).join(" ").trim();
      if (typed) { const n = noteWrite(sh, row, who, "🧾 scope: " + typed); if (!n) return null; writes.push(n); }
      return { writes, logs: [[who, "Scope of Work note", piano, val || "(cleared)"]], result: { ok: true, scopeNotes: val } };
    }
    case "setpaperwork": {
      const kind = s(p.kind).trim().toLowerCase();
      if (!kind) return { writes: [], logs: [], result: { error: "kind required" } };
      const c = need("PAPERWORK"); if (!c) return null;
      let curJ: Record<string, unknown> = {};
      try { curJ = (JSON.parse(cur(c) || "{}") as Record<string, unknown>) || {}; } catch { curJ = {}; }
      const url = s(p.url).trim();
      if (!url) delete curJ[kind]; else curJ[kind] = { url: url.slice(0, 500), name: s(p.name).slice(0, 120) };
      return { writes: [{ col: c, value: Object.keys(curJ).length ? JSON.stringify(curJ) : "" }],
        logs: [[who, "Paperwork", piano, kind + (url ? " attached" : " removed")]], result: { ...base, paperwork: curJ } };
    }
    case "settrack": {
      const c = need("TRACK"); if (!c) return null;
      const tracks: string[] = [];
      for (const t0 of Array.isArray(p.tracks) ? (p.tracks as unknown[]) : []) {
        const t = s(t0).trim();
        if (TRACK_VALUES.includes(t) && !tracks.includes(t)) tracks.push(t);
      }
      const prev = cur(c);
      const misc = s(p.miscNote).trim().replace(/,/g, ";");
      const val = tracks.map(t => (t === "Misc" && misc ? "Misc (" + misc + ")" : t)).join(", ");
      return { writes: [{ col: c, value: val }], logs: [[who, "Track change", piano, (prev || "(none)") + " → " + (val || "(none)")]],
        result: { ...base, previous: prev, track: val } };
    }
    case "setphase": {
      let phase = s(p.phase).trim();
      if (phase && PHASE_MIGRATE[phase]) phase = PHASE_MIGRATE[phase];
      if (phase && !PHASE_VALUES.includes(phase)) return { writes: [], logs: [], result: { error: "unknown phase: " + phase } };
      // the two phases with side effects beyond cells stay on the bridge:
      // Delivered relocates the row below SOLD, Exit Prep - Admin texts admin
      if (phase === "Delivered" || phase === "Exit Prep - Admin") return null;
      const pc = need("CURRENT PHASE"); if (!pc) return null;
      const prev = cur(pc);
      const writes = [{ col: pc, value: phase }];
      const waiting = phase.indexOf("Waiting") === 0;
      // WAITING NOTE: written with Waiting phases, cleared when the piano moves on
      const nc = col(sh, "WAITING NOTE");
      const noteIn = s(p.note).trim();
      if (!nc && (noteIn || waiting)) return null;   // the bridge creates the column
      let note = "";
      if (nc) {
        if (waiting) { if (noteIn) { note = noteIn; writes.push({ col: nc, value: note }); } else note = cur(nc); }
        else writes.push({ col: nc, value: "" });
      }
      const cbc = col(sh, "CHECK BACK");
      const cbIn = s(p.checkBack).trim();
      if (!cbc && cbIn) return null;
      let cb = "";
      if (cbc) {
        if (waiting) { if (cbIn) { cb = cbIn; writes.push({ col: cbc, value: cb }); } else cb = cur(cbc); }
        else writes.push({ col: cbc, value: "" });
      }
      const logs: Plan["logs"] = [[who, "Phase change", piano, (prev || "(none)") + " → " + (phase || "(none)")]];
      // For Sale: every shop phase is complete by definition — tick them all (adds only)
      let autoDone: string | null = null;
      if (phase === "For Sale" && prev !== "For Sale") {
        const dc = col(sh, "PHASES DONE");
        if (dc) {
          const had = cur(dc).split(",").map(t => t.trim()).filter(Boolean);
          const work = PHASE_VALUES.slice(0, 13);
          if (work.some(ph => !had.includes(ph))) { autoDone = work.join(", "); writes.push({ col: dc, value: autoDone }); }
        }
        if (autoDone) logs.push([who, "Phases auto-completed", piano, "For Sale — all shop phases marked done"]);
      }
      return { writes, logs, result: { ...base, previous: prev, phase, note, checkBack: cb, movedToSold: false, done: autoDone, autoCompleted: !!autoDone } };
    }
    default:
      return null;
  }
}

/* ---------- entry point ---------- */
export const DIRECT_ACTIONS = /^(setcardfield|setplatestatus|setcabinetry|setplatehw|setplatetemp|setadminsteps|setpayplan|setkeystatus|setclientreports|setimportant|setbenchnote|setscopenote|setpaperwork|settrack|setphase|move)$/;

export function directConfigured(): boolean {
  return !!(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY) && process.env.PIANOLOG_DIRECT_WRITES !== "off";
}

/**
 * Apply a relayed Store Map write straight to the Piano Log.
 * Resolves to the bridge-shaped result, or null when this write is the
 * bridge's job. Throws on a Sheets API failure (caller falls back to the
 * bridge — nothing was written when it throws before batchWrite).
 */
export async function directWrite(action: string, p: Payload): Promise<DirectResult | null> {
  if (!directConfigured() || !DIRECT_ACTIONS.test(action)) return null;
  if (p.replayOf) return null;   // replays are the queue worker's, through the bridge's own guards
  const auth = await whoFor(p);
  if (!auth) return null;
  const { who, g } = auth;
  const sh = await readSheet();
  const f = findRow(sh, p.serial, p.row);
  if (f.error) return { error: f.error };
  const rowNum = f.row as number;
  const want = s(p.serial).trim().toLowerCase();

  let pl: Plan | null;
  let bumps: Array<{ row: number; summary: string; serial: string }> = [];
  if (action === "move") {
    const dest = s(p.newLocation).trim();
    if (!dest) return null;   // a bare lookup — bridge
    const ro = Number(p.row);
    const rowOk = ro >= 1 && ro <= sh.serials.length && (sh.serials[ro - 1] || "").trim().toLowerCase() === want;
    if (f.matches.length > 1 && !rowOk) return { error: "multiple active rows share this serial", rows: f.matches };
    const summary = sh.summaries[rowNum - 1] || "";
    const current = sh.locs[rowNum - 1] || "";
    const logs: Plan["logs"] = [[who, "Moved", summary || s(p.serial), (current || "(blank)") + " → " + dest]];
    const writes = [{ col: LOC_COL, value: dest }];
    // one piano per spot: whoever was already there goes to the attic (bridge: bumpOthers_)
    if (/^\d+[a-zA-Z]?$/.test(dest)) {
      for (let r = 1; r < sh.soldRow; r++) {
        if (r === rowNum) continue;
        if ((sh.locs[r - 1] || "").trim().toLowerCase() !== dest.toLowerCase()) continue;
        if (!(sh.serials[r - 1] || "").trim() && !(sh.summaries[r - 1] || "").trim()) continue;   // not a piano row
        bumps.push({ row: r, summary: sh.summaries[r - 1] || "", serial: (sh.serials[r - 1] || "").trim() });
      }
      for (const b of bumps) logs.push([who, "Bumped to attic", b.summary, "spot " + dest + " reassigned; awaiting a new spot"]);
    }
    pl = { writes, logs, result: { ok: true, moved: true, row: rowNum, summary, previous: current, location: dest, bumped: bumps } };
  } else {
    // the piano's own row, in one read — its serial is checked right here
    const [row] = await batchGet([`'${TAB}'!A${rowNum}:ZZ${rowNum}`]);
    const r0 = (row[0] || []).map(s);
    if (s(r0[2]).trim().toLowerCase() !== want) return { error: "the Piano Log rows shifted while saving — refresh and try again" };
    pl = plan(action, p, sh, rowNum, r0, who, g);
  }
  if (!pl) return null;
  if (pl.result.error) return pl.result;

  // write: this piano's cells, plus (for a move) the bumped pianos' location
  const data = pl.writes.map(w => ({ range: cell(rowNum, w.col), values: [[w.value]] }));
  for (const b of bumps) data.push({ range: cell(b.row, LOC_COL), values: [["Attic — bumped from " + s(p.newLocation).trim()]] });
  await batchWrite(data);

  // did the row move under us? (the other bridge reorders rows) — say so, never pretend
  const [chk] = await batchGet([`'${TAB}'!C${rowNum}`], 5000).catch(() => [[]] as string[][][]);
  const after = s(chk?.[0]?.[0]).trim().toLowerCase();
  if (chk && chk.length && after !== want) {
    await logAct([[who, "⚠ Row moved during write", s(p.serial), action + " landed on row " + rowNum + " which now holds " + (after || "(blank)") + " — check both pianos"]]);
    return { error: "the Piano Log rows shifted while saving — refresh and check " + (sh.summaries[rowNum - 1] || s(p.serial)) };
  }
  await logAct(pl.logs);
  return { ...pl.result, direct: true };
}
