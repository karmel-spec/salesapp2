/**
 * Store Map — bridge queue worker (step 6, Brigham 9/3). Drains queued
 * piano-log ops that the inline relay couldn't confirm: forwards each to
 * the Apps Script bridge until a REAL (non-ping) result comes back.
 * Idempotent ops only live in this queue, so re-sends are harmless.
 *
 * GET ?key=… → {ok, drained, stillQueued, gaveUp}
 * Also runs from bridge-queue-worker-cron every 5 minutes.
 */
import { forwardToBridge } from "./pianolog-write.mts";

const MAX_ATTEMPTS = 40;

function sbHeaders() {
  const key = process.env.SUPABASE_SERVICE_KEY || "";
  return { apikey: key, Authorization: "Bearer " + key, "Content-Type": "application/json" };
}

export default async (req: Request) => {
  const url = new URL(req.url);
  if ((url.searchParams.get("key") || "") !== (process.env.BLP_APP_ACCESS_KEY || "")) {
    return new Response(JSON.stringify({ error: "bad key" }), { status: 401 });
  }
  const SB = process.env.SUPABASE_URL || "";
  if (!SB || !process.env.SUPABASE_SERVICE_KEY) {
    return new Response(JSON.stringify({ error: "not configured" }), { status: 503 });
  }
  const r = await fetch(
    `${SB}/rest/v1/bridge_queue?status=eq.queued&order=created.asc&limit=8`,
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
    // a replay is marked (Walter 10/6) so the bridge can skip a move that
    // already landed or that a newer move has replaced since it was queued
    const fw = await forwardToBridge({ ...(row.payload as object), replayOf: row.id, queuedAt: row.created || "" }, 9000);
    const patch: Record<string, unknown> = { updated: new Date().toISOString(), attempts: row.attempts + 1 };
    if (fw.kind === "real") {
      patch.status = "done";
      patch.result = fw.body;
      drained++;
    } else {
      patch.last_error = fw.err || fw.kind;
      if (row.attempts + 1 >= MAX_ATTEMPTS) { patch.status = "failed"; gaveUp++; }
    }
    await fetch(`${SB}/rest/v1/bridge_queue?id=eq.${row.id}`, {
      method: "PATCH", headers: sbHeaders(), body: JSON.stringify(patch),
    }).catch(() => {});
  }
  return new Response(JSON.stringify({
    ok: true, drained, gaveUp, stillQueued: rows.length - drained - gaveUp,
  }), { headers: { "content-type": "application/json" } });
};
