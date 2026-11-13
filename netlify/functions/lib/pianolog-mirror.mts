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
import { getStore } from "@netlify/blobs";

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
  // A:ZZ, not A:EZ (Mark 11/10): the 11/6 column inserts pushed PAY TRACK to FA,
  // past the old range, so every piano's payment marks read blank from the mirror
  const [values, roster] = await Promise.all([get("'Piano Log'!A1:ZZ5000"), get("'App Access'!A1:C300").catch(() => [] as string[][])]);
  return { values, roster, ms: Date.now() - t0 };
}

/** Queued (not yet landed) bridge writes, by serial: the sheet does not hold
 *  these values yet, so the fresh sheet row is synced with each queued op's
 *  absolute value re-applied on top — row order, queue numbers and every
 *  other column stay current while the pending change is not undone. */
async function openQueueOps(): Promise<Map<string, Array<{ action: string; payload: Record<string, unknown> }>>> {
  const out = new Map<string, Array<{ action: string; payload: Record<string, unknown> }>>();
  try {
    // queued, or claimed by a drain that is forwarding it right now (sending)
    // — neither is in the sheet yet
    const r = await fetch(`${SB()}/rest/v1/bridge_queue?status=in.(queued,sending)&select=action,payload&order=created.asc`, { headers: sbHeaders(), signal: AbortSignal.timeout(10000) });
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
  mode?: "delta" | "full"; why?: string; sent?: number;
}

/* ---------- LIGHTER SYNC (Mark 11/13) ----------
 * Every run used to upload the WHOLE Piano Log to Supabase — ~3,170 rows,
 * 14.8 MB of JSON in 13 calls, every 3 minutes and after every write (~7 GB a
 * day) — only for the database to find that nothing, or one row, had changed.
 * The 11/6–11/11 midday outages were the plan's daily allowance running out
 * (Karmel 11/13).
 *
 * Now the sync remembers each row's content hash from the last successful
 * run in Netlify Blobs (store "pianolog-sync") and sends only the rows whose
 * hash differs — the same test pianolog_sync_upsert applies (`where p.hash is
 * distinct from excluded.hash`), made before the upload instead of after it.
 * Row removals are unchanged: pianolog_sync_finish still gets every key seen.
 *
 * The remembered hashes are trusted only when they provably describe the
 * database: the "state" blob names the run that wrote them, and that must be
 * the database's latest successful run (pianolog_sync_runs). Anything else —
 * no blob, a run that finished without saving its blobs, another writer, an
 * outage — sends everything, as before. A full run also happens once a day,
 * and on demand with {full:true} (pianolog-sync-status ?now=1&full=1).
 * Optimistic patches (pianolog_patch) never touch `hash`, in the table or
 * here, so they are confirmed or corrected by the sheet exactly as before. */
interface SyncState { run: number; hashesV: number; fullAt: number }
interface HashBlob { v: number; hashes: Record<string, string> }
interface RunRow { id: number; ok: boolean | null; started: string; finished: string | null }
// strong consistency: a sync often starts seconds after the last one finished,
// and a stale "state" would only ever force a needless full run — but needless
// full runs are exactly what this is here to stop
const syncStore = () => { try { return getStore({ name: "pianolog-sync", consistency: "strong" }); } catch { return getStore("pianolog-sync"); } };
// the daily full run lands in the small hours: due when the last one was before
// the most recent 10:00 UTC (3 AM Mountain standard / 4 AM daylight time)
function fullRunDue(fullAt: number, now = Date.now()): boolean {
  const d = new Date(now);
  let boundary = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 10, 0, 0);
  if (boundary > now) boundary -= 24 * 3600 * 1000;
  return (fullAt || 0) < boundary;
}

async function priorHashes(run: number, wantFull: boolean): Promise<{ hashes: Record<string, string> | null; state: SyncState | null; why: string }> {
  if (wantFull) return { hashes: null, state: null, why: "full run requested" };
  try {
    const store = syncStore();
    const state = (await store.get("state", { type: "json" })) as SyncState | null;
    if (!state || !state.run) return { hashes: null, state: null, why: "no remembered hashes yet" };
    if (fullRunDue(state.fullAt)) return { hashes: null, state, why: "daily full run" };
    // the database's latest SUCCESSFUL run must be the one that wrote the blobs
    const runs = await rpc<RunRow[]>("pianolog_sync_runs", { p_limit: 8 }, 15000);
    const lastOk = (runs || []).find((r) => r.id !== run && r.ok === true && r.finished);
    if (!lastOk) return { hashes: null, state, why: "no recent successful run" };
    if (lastOk.id !== state.run) return { hashes: null, state, why: `hashes are from run ${state.run}, database is at run ${lastOk.id}` };
    const blob = (await store.get("hashes", { type: "json" })) as HashBlob | null;
    if (!blob || blob.v !== state.hashesV || !blob.hashes) return { hashes: null, state, why: "hash list missing or out of step" };
    return { hashes: blob.hashes, state, why: "" };
  } catch (e) {
    return { hashes: null, state: null, why: "hash store unreadable: " + String((e as Error).message || e).slice(0, 80) };
  }
}

export async function runSync(source: string, opts: { full?: boolean } = {}): Promise<SyncResult> {
  const t0 = Date.now();
  if (!mirrorConfigured()) return { ok: false, error: "SUPABASE_SERVICE_KEY not set" };
  const run = await rpc<number | null>("pianolog_sync_begin", { p_source: source });
  if (run == null) return { ok: true, skippedRun: true, run: null, totalMs: Date.now() - t0 };
  let rows = 0, changed = 0, skipped = 0, sent = 0;
  try {
    const [{ values, roster, ms }, queued, prior] = await Promise.all([readSheet(), openQueueOps(), priorHashes(run, !!opts.full)]);
    if (values.length < 10) throw new Error("sheet read returned " + values.length + " rows — not syncing");
    const parsed = parser.parseAll(values);
    rows = parsed.rows.length;
    const mode: "delta" | "full" = prior.hashes ? "delta" : "full";
    const seen: string[] = [];
    const upserts: unknown[] = [];
    const hashes: Record<string, string> = {};
    let same = !!prior.hashes;   // does the new hash list equal the remembered one?
    for (const rec of parsed.rows) {
      seen.push(rec.key);
      const ops = rec.serial ? queued.get(rec.serial.toLowerCase()) : undefined;
      if (ops && applyQueued(rec as unknown as Record<string, unknown>, ops)) skipped++;   // "skipped" = synced with a queued write re-applied
      const h = String((rec as unknown as { hash?: string }).hash || "");
      hashes[rec.key] = h;
      if (prior.hashes && prior.hashes[rec.key] === h) continue;   // unchanged since the last successful run
      same = false;
      upserts.push(deepClean(rec));
    }
    if (same && prior.hashes && Object.keys(prior.hashes).length !== seen.length) same = false;   // a row vanished
    sent = upserts.length;
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
    // remember what the database now holds. Hash list first, then the state
    // that vouches for it — if either write fails, the next run finds them
    // out of step with the database and sends everything.
    // NOT when another run overlapped this one (a run that outlives the
    // 150-second lock): two runs writing at once can leave an older row on top
    // of a newer one, and a remembered hash would hide it until tomorrow's
    // full run. Saving nothing makes the next run send everything.
    try {
      const runs = await rpc<RunRow[]>("pianolog_sync_runs", { p_limit: 8 }, 15000);
      const mine = (runs || []).find((r) => r.id === run);
      // a run with no finish time that started over 15 minutes ago crashed (15 min is
      // the background function's limit) — it is not writing any more
      const alive = (r: RunRow) => !!r.finished || Date.now() - Date.parse(r.started) < 15 * 60000;
      const overlap = !mine || (runs || []).some((r) => r.id !== run && alive(r)
        && Date.parse(r.started) <= Date.parse(mine.finished || new Date().toISOString())
        && (!r.finished || Date.parse(r.finished) >= Date.parse(mine.started)));
      if (overlap) {
        console.warn("pianolog-sync: another run overlapped run", run, "— hash list not saved, next run sends everything");
      } else {
        const store = syncStore();
        const keep = same && !!prior.state;          // hash list identical to the remembered one
        const hashesV = keep ? prior.state!.hashesV : run;
        if (!keep) await store.setJSON("hashes", { v: run, hashes } as HashBlob);
        const fullAt = mode === "full" ? Date.now() : prior.state!.fullAt;
        await store.setJSON("state", { run, hashesV, fullAt } as SyncState);
      }
    } catch (e) {
      console.warn("pianolog-sync: could not save the hash list (next run sends everything):", String((e as Error).message || e).slice(0, 120));
    }
    const res: SyncResult = { ok: true, run, rows, changed, removed: fin?.removed || 0, skipped, sheetMs: ms, totalMs: Date.now() - t0,
      mode, why: prior.why || undefined, sent };
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
    case "setplatehw": {   // status dropdown (plateHwStatus) or hardware location box (value)
      if (payload.plateHwStatus != null) { const v = s(payload.plateHwStatus); p.sm.plateHwStatus = v; p.raw["PLATE HARDWARE STATUS"] = v; }
      else { const v = s(payload.value); p.sm.plateHw = v.slice(0, 80); p.raw["PLATE HW LOCATION"] = v; }
      break;
    }
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
    // Scope of Work picks (Melissa 11/9: a Keys pick looked unsaved — the mirror
    // kept the old value until the next full sync, and the card's poll took it back)
    case "setcardfield": {
      const f = s(payload.field), v = s(payload.value).replace(/\s+/g, " ").trim();
      const hdr = f === "plateFinish" ? "REQUESTED TRIM COLOR" : f === "keytopMaterial" ? "REQUESTED WHITE KEYTOP PLAN" : "";
      if (!hdr) return null;
      p.sm[f] = v.slice(0, 80); p.raw[hdr] = v;
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
