/**
 * Store Map — bridge queue worker (step 6, Brigham 9/3). Drains queued
 * piano-log ops that the inline relay couldn't confirm: forwards each to
 * the Apps Script bridge until a REAL (non-ping) result comes back.
 * Idempotent ops only live in this queue, so re-sends are harmless.
 *
 * GET ?key=… → {ok, drained, stillQueued, gaveUp} (one row, sync)
 * The 5-minute cron runs bridge-queue-worker-background (30 s per row).
 */
import { forwardToBridge } from "./pianolog-write.mts";
import { patchMirror, triggerSync } from "./lib/pianolog-mirror.mts";

const MAX_ATTEMPTS = 40;

function sbHeaders() {
  const key = process.env.SUPABASE_SERVICE_KEY || "";
  return { apikey: key, Authorization: "Bearer " + key, "Content-Type": "application/json" };
}

/* Drain queued rows (Walter 10/7): the bridge now often takes 13–30 s per
 * call, and a 9 s budget meant every replay "failed" although Google had
 * finished the write — so each op was re-sent every 5 minutes for hours.
 * The cron now runs this from a BACKGROUND function with a 30 s budget per
 * row, and the attempt is counted BEFORE the call so a cut-off run can't
 * replay a row forever. 6 rows × 30 s stays well inside the 5-min cadence. */
export async function drainQueue(budgetMs: number, limit: number) {
  const SB = process.env.SUPABASE_URL || "";
  const r = await fetch(
    `${SB}/rest/v1/bridge_queue?status=eq.queued&order=created.asc&limit=${limit}`,
    { headers: sbHeaders() },
  );
  const rows = (await r.json()) as Array<{ id: number; payload: unknown; attempts: number; created?: string }>;
  let drained = 0, gaveUp = 0;
  for (const row of rows) {
    // belt and braces (Walter 10/2): a Delivered phase change is never replayed
    // by a robot — see pianolog-write; any such row still queued is parked
    const pl = (row.payload || {}) as { action?: unknown; phase?: unknown };
    if (String(pl.action || "") === "setphase" && /^delivered$/i.test(String(pl.phase || ""))) {
      await fetch(`${SB}/rest/v1/bridge_queue?id=eq.${row.id}`, {
        method: "PATCH", headers: sbHeaders(),
        body: JSON.stringify({ status: "failed", last_error: "not replayed: Delivered is human-only", updated: new Date().toISOString() }),
      }).catch(() => {});
      gaveUp++;
      continue;
    }
    const attempts = row.attempts + 1;
    const out = attempts >= MAX_ATTEMPTS;
    // count the attempt first — if this run is cut off mid-call, the row
    // still moves toward MAX_ATTEMPTS instead of replaying indefinitely
    await fetch(`${SB}/rest/v1/bridge_queue?id=eq.${row.id}`, {
      method: "PATCH", headers: sbHeaders(),
      body: JSON.stringify({ attempts, updated: new Date().toISOString(), ...(out ? { status: "failed", last_error: "gave up after " + attempts + " attempts" } : {}) }),
    }).catch(() => {});
    if (out) { gaveUp++; continue; }
    // a replay is marked (Walter 10/6) so the bridge can skip a move or phase
    // change that already landed or that a newer change replaced
    const fw = await forwardToBridge({ ...(row.payload as object), replayOf: row.id, queuedAt: row.created || "" }, budgetMs);
    const patch: Record<string, unknown> = { updated: new Date().toISOString() };
    if (fw.kind === "real") {
      patch.status = "done";
      patch.result = fw.body;
      drained++;
      // read mirror (10/7): the bridge's real answer is the truth for this
      // serial now — patch the Supabase copy; a full sync follows the drain
      const body = (fw.body || {}) as Record<string, unknown>;
      if (!body.error && !body.stale) await patchMirror(String(pl.action || ""), row.payload as Record<string, unknown>, body);
    } else {
      patch.last_error = fw.err || fw.kind;
    }
    await fetch(`${SB}/rest/v1/bridge_queue?id=eq.${row.id}`, {
      method: "PATCH", headers: sbHeaders(), body: JSON.stringify(patch),
    }).catch(() => {});
  }
  if (drained) await triggerSync("queue");   // mirror catches up with every landed write
  return { drained, gaveUp, stillQueued: rows.length - drained - gaveUp };
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
