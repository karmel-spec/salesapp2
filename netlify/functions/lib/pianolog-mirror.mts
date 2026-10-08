/**
 * Piano Log → Supabase read mirror — shared helpers (phase 1, 2026-10-07).
 *
 * The Google Sheet STAYS the authority: staff keep editing it, and writes
 * keep going through the durable bridge_queue relay to the Apps Script
 * bridge. Supabase (schema `pianolog`, project blp-crm) is a fast READ copy:
 *   - runSync()      reads the whole tab via the service account, parses it
 *                    with the one shared parser, upserts changed rows, drops
 *                    rows whose serial vanished, records a sync_runs row
 *   - patchMirror()  optimistic patch of one row right after a relayed write
 *                    so the apps show the change before the next sync
 *   - triggerSync()  fire-and-forget kick of the background sync function
 * The `pianolog` schema is not exposed in PostgREST; everything goes through
 * the service_role-only RPCs created in supabase/pianolog_mirror.sql.
 */
import parser from "./pianolog-parse.cjs";
import { googleToken } from "../_blp-sched-lib.mts";

export const PIANO_LOG_ID = "1ZunbPKygpQlcXfTyPowDHdUE9spJ3uV1XA4iX1eoKRc";
export const SITE = "https://blpsalesapp.netlify.app";
const SB = () => (process.env.SUPABASE_URL || "https://ismacawxfvvllfinibbf.supabase.co").replace(/\/$/, "");
const KEY = () => process.env.SUPABASE_SERVICE_KEY || "";
const CHUNK = 250;

export function mirrorConfigured(): boolean {
  return !!KEY();
}

function sbHeaders() {
  return { apikey: KEY(), Authorization: "Bearer " + KEY(), "Content-Type": "application/json" };
}

export async function rpc<T = unknown>(name: string, body: Record<string, unknown>, timeoutMs = 60000): Promise<T> {
  const r = await fetch(`${SB()}/rest/v1/rpc/${name}`, {
    method: "POST", headers: sbHeaders(), body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs),
  });
  const txt = await r.text();
  if (!r.ok) throw new Error(`rpc ${name} ${r.status}: ${txt.slice(0, 200)}`);
  return (txt ? JSON.parse(txt) : null) as T;
}

/* a cell with a broken emoji (lone UTF-16 surrogate — row 27 had one on
 * 10/7) or a NUL is rejected by PostgREST / jsonb; the sheet's text keeps it,
 * the mirror drops just those code units */
function clean(values: string[][]): string[][] {
  for (const row of values) {
    for (let c = 0; c < row.length; c++) {
      const v = row[c];
      if (typeof v !== "string") { row[c] = v == null ? "" : String(v); continue; }
      if (!v.isWellFormed() || v.includes("\u0000")) row[c] = v.toWellFormed().replace(/�|\u0000/g, "");
    }
  }
  return values;
}

/* the parser truncates long notes (slice 300 / 2000 chars); a cut that lands
 * inside an emoji leaves a lone surrogate in the record, which PostgREST
 * rejects as invalid JSON — drop it from the mirror copy only */
function deepClean<T>(v: T): T {
  if (typeof v === "string") return (v.isWellFormed() ? v : v.toWellFormed().replace(/�/g, "")) as T;
  if (Array.isArray(v)) return v.map(deepClean) as T;
  if (v && typeof v === "object") {
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) o[deepClean(k)] = deepClean(x);
    return o as T;
  }
  return v;
}

/** The Piano Log tab (A1:EZ5000) and the App Access roster, via the service account. */
export async function readSheet(): Promise<{ values: string[][]; roster: string[][]; ms: number }> {
  const t0 = Date.now();
  const tok = await googleToken();
  const get = async (range: string) => {
    const r = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${PIANO_LOG_ID}/values/${encodeURIComponent(range)}?majorDimension=ROWS`,
      { headers: { Authorization: "Bearer " + tok }, signal: AbortSignal.timeout(90000) },
    );
    if (!r.ok) throw new Error(`sheet read ${range} failed (${r.status}) ${(await r.text()).slice(0, 160)}`);
    return clean(((await r.json()) as { values?: string[][] }).values || []);
  };
  const [values, roster] = await Promise.all([get("'Piano Log'!A1:EZ5000"), get("'App Access'!A1:C300").catch(() => [] as string[][])]);
  return { values, roster, ms: Date.now() - t0 };
}

/** Queued (not yet landed) bridge writes, by serial: the sheet does not hold
 *  these values yet, so the fresh sheet row is synced with each queued op's
 *  absolute value re-applied on top — row order, queue numbers and every
 *  other column stay current while the pending change is not undone. */
async function openQueueOps(): Promise<Map<string, Array<{ action: string; payload: Record<string, unknown> }>>> {
  const out = new Map<string, Array<{ action: string; payload: Record<string, unknown> }>>();
  try {
    const r = await fetch(`${SB()}/rest/v1/bridge_queue?status=eq.queued&select=action,payload&order=created.asc`, { headers: sbHeaders(), signal: AbortSignal.timeout(10000) });
    if (!r.ok) return out;
    for (const row of (await r.json()) as Array<{ action?: string; payload?: Record<string, unknown> }>) {
      const s = parser.normSerial(row.payload?.serial).toLowerCase();
      if (!s) continue;
      if (!out.has(s)) out.set(s, []);
      out.get(s)!.push({ action: String(row.action || ""), payload: row.payload || {} });
    }
  } catch { /* no queue list — every row syncs as the sheet holds it */ }
  return out;
}

function applyQueued(rec: Record<string, unknown>, ops: Array<{ action: string; payload: Record<string, unknown> }>): boolean {
  let applied = false;
  for (const op of ops) {
    const p = patchForAction(op.action, op.payload);
    if (!p) continue;
    applied = true;
    for (const [k, v] of Object.entries(p.cols)) rec[k] = v;
    if (rec.sm) Object.assign(rec.sm as Record<string, unknown>, p.sm);
    if (rec.pl) Object.assign(rec.pl as Record<string, unknown>, p.pl);
    Object.assign(rec.raw as Record<string, unknown>, p.raw);
  }
  if (applied) rec.hash = String(rec.hash) + "+q";   // content differs from the plain sheet row
  return applied;
}

export interface SyncResult {
  ok: boolean; run?: number | null; rows?: number; changed?: number; removed?: number; skipped?: number;
  sheetMs?: number; totalMs?: number; error?: string; skippedRun?: boolean;
}

export async function runSync(source: string): Promise<SyncResult> {
  const t0 = Date.now();
  if (!mirrorConfigured()) return { ok: false, error: "SUPABASE_SERVICE_KEY not set" };
  const run = await rpc<number | null>("pianolog_sync_begin", { p_source: source });
  if (run == null) return { ok: true, skippedRun: true, run: null, totalMs: Date.now() - t0 };
  let rows = 0, changed = 0, skipped = 0;
  try {
    const [{ values, roster, ms }, queued] = await Promise.all([readSheet(), openQueueOps()]);
    if (values.length < 10) throw new Error("sheet read returned " + values.length + " rows — not syncing");
    const parsed = parser.parseAll(values);
    rows = parsed.rows.length;
    const seen: string[] = [];
    const upserts: unknown[] = [];
    for (const rec of parsed.rows) {
      seen.push(rec.key);
      const ops = rec.serial ? queued.get(rec.serial.toLowerCase()) : undefined;
      if (ops && applyQueued(rec as unknown as Record<string, unknown>, ops)) skipped++;   // "skipped" = synced with a queued write re-applied
      upserts.push(deepClean(rec));
    }
    for (let i = 0; i < upserts.length; i += CHUNK) {
      changed += Number(await rpc<number>("pianolog_sync_upsert", { p_run: run, p_rows: upserts.slice(i, i + CHUNK) }, 120000)) || 0;
    }
    const meta = {
      sections: parsed.sections,
      header_keys: parsed.keys,
      queue: parsed.queue,
      app_access: roster,
      parser: "pianolog-parse v1",
      sheet_rows: values.length,
    };
    const fin = await rpc<{ removed: number }>("pianolog_sync_finish", {
      p_run: run, p_seen: seen, p_ok: true, p_error: null, p_rows: rows, p_changed: changed, p_skipped: skipped, p_meta: meta,
    });
    const res: SyncResult = { ok: true, run, rows, changed, removed: fin?.removed || 0, skipped, sheetMs: ms, totalMs: Date.now() - t0 };
    console.log("pianolog-sync:", source, JSON.stringify(res));
    return res;
  } catch (e) {
    const error = String((e as Error).message || e).slice(0, 400);
    await rpc("pianolog_sync_finish", { p_run: run, p_seen: [], p_ok: false, p_error: error, p_rows: rows, p_changed: changed, p_skipped: skipped }).catch(() => {});
    console.error("pianolog-sync failed:", source, error);
    return { ok: false, run, error, totalMs: Date.now() - t0 };
  }
}

/** Kick the background sync (returns as soon as Netlify has accepted the job). */
export async function triggerSync(source: string): Promise<void> {
  try {
    const key = process.env.BLP_APP_ACCESS_KEY || "";
    await fetch(`${SITE}/.netlify/functions/pianolog-sync-background?key=${encodeURIComponent(key)}&source=${encodeURIComponent(source)}`,
      { method: "POST", signal: AbortSignal.timeout(8000) });
  } catch (e) {
    console.warn("pianolog-sync trigger failed:", String((e as Error).message || e).slice(0, 120));
  }
}

/* ---------- optimistic patch ----------
 * Maps a relayed bridge write (payload as the Store Map client sends it, plus
 * the bridge's own result when the inline attempt succeeded) onto the mirror
 * row: the typed columns, the Store Map record (sm), the Piano Log app record
 * (pl) and the raw header-keyed row. Only absolute-value ops are relayed, so
 * the patch is exactly what the sheet will hold once the bridge applies it. */
type Patch = { serial: string; cols: Record<string, string>; sm: Record<string, unknown>; pl: Record<string, string>; raw: Record<string, string> };

const MEDIA = { bphoto: ["bphoto", "BEFORE PHOTOS", "before_photos"], bvideo: ["bvideo", "BEFORE VIDEO", "before_video"],
  aphoto: ["aphoto", "AFTER PHOTOS", "after_photos"], avideo: ["avideo", "AFTER VIDEO", "after_video"] } as Record<string, string[]>;

export function patchForAction(action: string, payload: Record<string, unknown>, result?: Record<string, unknown>): Patch | null {
  const serial = parser.normSerial(payload.serial);
  if (!serial) return null;
  const s = (v: unknown) => (v == null ? "" : String(v));
  const p: Patch = { serial, cols: {}, sm: {}, pl: {}, raw: {} };
  const resLoc = result && typeof result.location === "string" ? result.location : null;
  switch (action) {
    case "setphase": {
      const phase = s(result && typeof result.phase === "string" ? result.phase : payload.phase).trim();
      p.cols.phase = phase; p.sm.phase = phase; p.pl.current_phase = phase; p.raw["CURRENT PHASE"] = phase;
      p.sm.archived = /delivered/i.test(phase);
      if (payload.note != null) { p.sm.waitNote = s(payload.note); p.raw["WAITING NOTE"] = s(payload.note); }
      if (payload.checkBack != null && s(payload.checkBack)) { p.sm.checkBack = s(payload.checkBack); p.raw["CHECK BACK"] = s(payload.checkBack); }
      break;
    }
    case "move": {
      const loc = s(resLoc ?? payload.newLocation).trim();
      if (!loc) return null;
      p.cols.location = loc; p.sm.location = loc; p.sm.isSlot = parser.SLOT_RE.test(loc);
      p.pl.location_status = loc; p.raw["LOCATION / STATUS"] = loc;
      break;
    }
    case "setprice": {
      const price = s(payload.price).trim();
      p.cols.price = /\d/.test(price) ? price : ""; p.sm.price = p.cols.price; p.raw["TAG / INVOICE PRICE"] = price;
      break;
    }
    case "settrack": {
      const list = Array.isArray(payload.tracks) ? (payload.tracks as unknown[]).map(s) : [s(payload.tracks)];
      const track = list.filter(Boolean).join(", ");
      p.cols.track = track; p.sm.track = track; p.pl.track = track; p.raw["TRACK"] = track;
      break;
    }
    case "setdone": {
      const list = Array.isArray(payload.phases) ? (payload.phases as unknown[]).map(s) : [s(payload.phases)];
      const done = list.filter(Boolean).join(", ");
      p.sm.phasesDone = done; p.raw["PHASES DONE"] = done;
      break;
    }
    case "setkeystatus": { const v = s(payload.value); p.sm.keytopStatus = v.slice(0, 40); p.raw["KEYTOP STATUS"] = v; break; }
    case "setplatestatus": { const v = s(payload.plateStatus); p.sm.plateStatus = v; p.raw["PLATE STATUS"] = v; break; }
    case "setplatetemp": { const v = s(payload.value); p.sm.plateTemp = v.slice(0, 90); p.raw["PLATE TEMP SPOT"] = v; break; }
    case "setcabinetry": { const v = s(payload.cabinetry); p.sm.cabinetry = v; p.raw["CABINETRY"] = v; break; }
    case "setclientreports": { const v = payload.enabled ? "✓" : ""; p.sm.clientReports = v; p.raw["CLIENT REPORTS"] = v; break; }
    case "setmedia": {
      const m = MEDIA[s(payload.field)];
      if (!m) return null;
      p.sm[m[0]] = payload.skip ? "skip" : true;
      p.raw[m[1]] = payload.skip ? "Skipped" : "✓";
      p.pl[m[2]] = payload.skip ? "Skipped" : "✓";
      break;
    }
    default:
      return null;   // other setters land with the next sync (≤ 3 min)
  }
  return p;
}

/** Apply an optimistic patch; false when nothing applied (unknown op, serial not unique). */
export async function patchMirror(action: string, payload: Record<string, unknown>, result?: Record<string, unknown>): Promise<boolean> {
  if (!mirrorConfigured()) return false;
  const patch = patchForAction(action, payload, result);
  if (!patch) return false;
  try {
    return !!(await rpc<boolean>("pianolog_patch", { p_serial: patch.serial, p_cols: patch.cols, p_sm: patch.sm, p_pl: patch.pl, p_raw: patch.raw }, 8000));
  } catch (e) {
    console.warn("pianolog patch failed:", String((e as Error).message || e).slice(0, 120));
    return false;
  }
}
