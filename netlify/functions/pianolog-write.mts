/**
 * Store Map — DURABLE PIANO LOG WRITE RELAY (speed/reliability step 6,
 * Brigham 9/3: "ENSURE every change is SAVED").
 *
 * The client sends the exact payload it would send the Apps Script
 * bridge (setphase / move / set* — idempotent ops only). This function:
 *   1. records the op in Supabase `bridge_queue` (durable, instant),
 *   2. tries the bridge inline with a short budget — a REAL bridge
 *      result marks the row done and is returned verbatim,
 *   3. if Google misroutes (generic ping), times out, or errors, the op
 *      stays queued and the client gets {ok:true, queued:true} — the
 *      worker (bridge-queue-worker) retries until the bridge confirms.
 *
 * Only resend-safe ops belong here: everything whitelisted sets absolute
 * values, so a retry after an ambiguous timeout cannot double-apply.
 */
const BRIDGE_URL =
  "https://script.google.com/macros/s/AKfycbxY4BKnr_Tr0iCTc9itCWhNYLvgszmkI1IoYSkbBWpyAqRtWI-yaUkJQjcVdgG58KXt/exec";
const ALLOW = ["https://blpstoremap.netlify.app", "http://localhost:8641"];
const RELAY_OK = /^(set[a-z]+|move|unmarkduplicate|tempresolve)$/;

function cors(origin: string | null) {
  const o = origin && ALLOW.includes(origin) ? origin : ALLOW[0];
  return {
    "access-control-allow-origin": o,
    "access-control-allow-headers": "content-type",
    "content-type": "application/json",
  };
}
function sbHeaders() {
  const key = process.env.SUPABASE_SERVICE_KEY || "";
  return { apikey: key, Authorization: "Bearer " + key, "Content-Type": "application/json" };
}

// a bridge response only counts when it's JSON and NOT the generic ping
export function realBridgeResult(j: unknown): boolean {
  return !!j && typeof j === "object" && !("service" in (j as object));
}

export async function forwardToBridge(payload: unknown, budgetMs: number): Promise<{ kind: "real" | "ping" | "fail"; body?: unknown; err?: string }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), budgetMs);
  try {
    const r = await fetch(BRIDGE_URL, {
      method: "POST",
      redirect: "follow",
      headers: { "content-type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    const txt = await r.text();
    let j: unknown;
    try { j = JSON.parse(txt); } catch { return { kind: "fail", err: "non-JSON " + txt.slice(0, 60) }; }
    return realBridgeResult(j) ? { kind: "real", body: j } : { kind: "ping" };
  } catch (e) {
    return { kind: "fail", err: String((e as Error).message || e).slice(0, 120) };
  } finally {
    clearTimeout(t);
  }
}

export default async (req: Request) => {
  const headers = cors(req.headers.get("origin"));
  if (req.method === "OPTIONS") return new Response("", { headers });
  const SB = process.env.SUPABASE_URL || "";
  if (!SB || !process.env.SUPABASE_SERVICE_KEY) {
    return new Response(JSON.stringify({ error: "relay not configured" }), { status: 503, headers });
  }
  let p: Record<string, unknown>;
  try { p = await req.json(); } catch { return new Response(JSON.stringify({ error: "bad json" }), { status: 400, headers }); }
  if (p.relayKey !== (process.env.BLP_APP_ACCESS_KEY || "")) {
    return new Response(JSON.stringify({ error: "unauthorized", dbg: { keys: Object.keys(p), rk: typeof p.relayKey, envSet: !!process.env.BLP_APP_ACCESS_KEY, envLen: (process.env.BLP_APP_ACCESS_KEY || "").length } }), { status: 401, headers });
  }
  const action = String(p.action || "");
  if (!RELAY_OK.test(action)) {
    return new Response(JSON.stringify({ error: "action not relayable: " + action }), { status: 400, headers });
  }
  const { relayKey: _drop, ...payload } = p;

  // 1. durable record first — the op can no longer be lost
  const ins = await fetch(SB + "/rest/v1/bridge_queue", {
    method: "POST",
    headers: { ...sbHeaders(), Prefer: "return=representation" },
    body: JSON.stringify({ action, payload }),
  });
  if (!ins.ok) {
    return new Response(JSON.stringify({ error: "queue write failed " + ins.status }), { status: 502, headers });
  }
  const qid = ((await ins.json()) as Array<{ id: number }>)[0]?.id;

  // 2. inline attempt — most of the time Google behaves and the caller
  //    gets the bridge's true result (bumped lists, done flags, …)
  const fw = await forwardToBridge(payload, 8000);
  if (fw.kind === "real") {
    await fetch(`${SB}/rest/v1/bridge_queue?id=eq.${qid}`, {
      method: "PATCH", headers: sbHeaders(),
      body: JSON.stringify({ status: "done", result: fw.body, attempts: 1, updated: new Date().toISOString() }),
    }).catch(() => {});
    return new Response(JSON.stringify(fw.body), { headers });
  }
  await fetch(`${SB}/rest/v1/bridge_queue?id=eq.${qid}`, {
    method: "PATCH", headers: sbHeaders(),
    body: JSON.stringify({ attempts: 1, last_error: fw.err || fw.kind, updated: new Date().toISOString() }),
  }).catch(() => {});
  // 3. still queued — honest ack: saved durably, applying shortly
  return new Response(JSON.stringify({ ok: true, queued: true, qid }), { headers });
};
