/**
 * Store Map — bridge queue worker (step 6, Brigham 9/3). Drains queued
 * piano-log ops that the inline relay couldn't confirm: forwards each to
 * the Apps Script bridge until a REAL (non-ping) result comes back.
 * Idempotent ops only live in this queue, so re-sends are harmless.
 *
 * GET ?key=… → {ok, drained, stillQueued, gaveUp} (one row, sync)
 * The 5-minute cron runs bridge-queue-worker-background (30 s per row), and
 * since 10/14 pianolog-write kicks the same background drain the moment a
 * write is queued, so a row normally lands within ~15–30 s of the tap.
 */
import { forwardToBridge } from "./pianolog-write.mts";
import { patchMirror, triggerSync } from "./lib/pianolog-mirror.mts";

const MAX_ATTEMPTS = 40;

function sbHeaders() {
  const key = process.env.SUPABASE_SERVICE_KEY || "";
  return { apikey: key, Authorization: "Bearer " + key, "Content-Type": "application/json" };
}

type Row = { id: number; payload: unknown; attempts: number; created?: string; status?: string };
// a row claimed ("sending") this long ago belongs to a drain that was cut off
// mid-call — it goes back on the list
const STALE_CLAIM_MS = 3 * 60 * 1000;

/* Claim one row for this drain (10/14): pianolog-write now kicks a drain the
 * moment a write is queued AND the 5-minute cron still runs one, so two drains
 * can overlap — each row is moved queued → sending by a conditional PATCH, so
 * only one of them forwards it. The attempt is counted in the same PATCH: if
 * this run is cut off mid-call, the row still moves toward MAX_ATTEMPTS
 * instead of replaying indefinitely. Returns the claimed row or null when
 * another drain got there first. */
async function claim(SB: string, row: Row, staleBefore: string): Promise<Row | null> {
  const attempts = row.attempts + 1;
  const cond = row.status === "sending"
    ? `id=eq.${row.id}&status=eq.sending&updated=lt.${encodeURIComponent(staleBefore)}`
    : `id=eq.${row.id}&status=eq.queued`;
  const r = await fetch(`${SB}/rest/v1/bridge_queue?${cond}`, {
    method: "PATCH", headers: { ...sbHeaders(), Prefer: "return=representation" },
    body: JSON.stringify({ status: "sending", attempts, updated: new Date().toISOString() }),
  }).catch(() => null);
  if (!r || !r.ok) return null;
  const got = (await r.json().catch(() => [])) as Row[];
  return got.length ? { ...row, attempts } : null;
}

/* Drain queued rows (Walter 10/7): the bridge now often takes 13–30 s per
 * call, and a 9 s budget meant every replay "failed" although Google had
 * finished the write — so each op was re-sent every 5 minutes for hours.
 * The cron runs this from a BACKGROUND function with a 30 s budget per row,
 * and so does the kick after every queued write (10/14). 6 rows × 30 s stays
 * well inside the 5-min cadence. */
export async function drainQueue(budgetMs: number, limit: number) {
  const SB = process.env.SUPABASE_URL || "";
  const staleBefore = new Date(Date.now() - STALE_CLAIM_MS).toISOString();
  const r = await fetch(
    `${SB}/rest/v1/bridge_queue?or=(status.eq.queued,and(status.eq.sending,updated.lt.${encodeURIComponent(staleBefore)}))&order=created.asc&limit=${limit}`,
    { headers: sbHeaders() },
  );
  const rows = (await r.json()) as Row[];
  let drained = 0, gaveUp = 0, skipped = 0;
  for (const row0 of rows) {
    // belt and braces (Walter 10/2): a Delivered phase change is never replayed
    // by a robot — see pianolog-write; any such row still queued is parked
    const pl = (row0.payload || {}) as { action?: unknown; phase?: unknown };
    if (String(pl.action || "") === "setphase" && /^delivered$/i.test(String(pl.phase || ""))) {
      await fetch(`${SB}/rest/v1/bridge_queue?id=eq.${row0.id}`, {
        method: "PATCH", headers: sbHeaders(),
        body: JSON.stringify({ status: "failed", last_error: "not replayed: Delivered is human-only", updated: new Date().toISOString() }),
      }).catch(() => {});
      gaveUp++;
      continue;
    }
    const row = await claim(SB, row0, staleBefore);
    if (!row) { skipped++; continue; }   // another drain has it
    if (row.attempts >= MAX_ATTEMPTS) {
      await fetch(`${SB}/rest/v1/bridge_queue?id=eq.${row.id}`, {
        method: "PATCH", headers: sbHeaders(),
        body: JSON.stringify({ status: "failed", last_error: "gave up after " + row.attempts + " attempts", updated: new Date().toISOString() }),
      }).catch(() => {});
      gaveUp++;
      continue;
    }
    // a replay is marked (Walter 10/6) so the bridge can skip a move or phase
    // change that already landed or that a newer change replaced
    const fw = await forwardToBridge({ ...(row.payload as object), replayOf: row.id, queuedAt: row.created || "" }, budgetMs);
    const patch: Record<string, unknown> = { updated: new Date().toISOString() };
    if (fw.kind === "real") {
      // read mirror (10/7): the bridge's real answer is the truth for this
      // serial now — patch the Supabase copy; a full sync follows the drain
      const body = (fw.body || {}) as Record<string, unknown>;
      // a real answer can still be a refusal ("serial not found above the SOLD
      // section") — a failure the app should hear about, not "done" (Hunter
      // 10/9, 100926rawlings10: moves that said "Saved" never landed)
      patch.status = body.error ? "failed" : "done";
      patch.result = fw.body;
      if (body.error) patch.last_error = String(body.error).slice(0, 200);
      drained++;
      if (!body.error && !body.stale) await patchMirror(String(pl.action || ""), row.payload as Record<string, unknown>, body);
    } else {
      patch.status = "queued";   // back on the list for the next drain
      patch.last_error = fw.err || fw.kind;
    }
    await fetch(`${SB}/rest/v1/bridge_queue?id=eq.${row.id}`, {
      method: "PATCH", headers: sbHeaders(), body: JSON.stringify(patch),
    }).catch(() => {});
  }
  if (drained) await triggerSync("queue");   // mirror catches up with every landed write
  return { drained, gaveUp, skipped, stillQueued: rows.length - drained - gaveUp - skipped };
}

export default async (req: Request) => {
  const url = new URL(req.url);
  if ((url.searchParams.get("key") || "") !== (process.env.BLP_APP_ACCESS_KEY || "")) {
    return new Response(JSON.stringify({ error: "bad key" }), { status: 401 });
  }
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return new Response(JSON.stringify({ error: "not configured" }), { status: 503 });
  }
  // manual / synchronous drain: one row, inside the sync function limit
  const res = await drainQueue(9000, 1);
  return new Response(JSON.stringify({ ok: true, ...res }), { headers: { "content-type": "application/json" } });
};
