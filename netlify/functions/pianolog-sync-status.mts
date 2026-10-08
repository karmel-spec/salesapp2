/**
 * Piano Log read mirror — status (key-gated).
 *   GET ?key=…            → last sync runs + last_sync meta
 *   GET ?key=…&now=1      → run a sync INLINE first (verification; ~5–15 s), then report
 */
import { rpc, runSync, mirrorConfigured } from "./lib/pianolog-mirror.mts";

export default async (req: Request) => {
  const url = new URL(req.url);
  const headers = { "content-type": "application/json", "cache-control": "no-store" };
  if ((url.searchParams.get("key") || "") !== (process.env.BLP_APP_ACCESS_KEY || "")) {
    return new Response(JSON.stringify({ error: "bad key" }), { status: 401, headers });
  }
  if (!mirrorConfigured()) return new Response(JSON.stringify({ error: "SUPABASE_SERVICE_KEY not set" }), { status: 503, headers });
  let last: unknown = null;
  if (url.searchParams.get("now") === "1") last = await runSync("manual");
  const [runs, meta] = await Promise.all([
    rpc("pianolog_sync_runs", { p_limit: Number(url.searchParams.get("n") || 10) }),
    rpc<Record<string, unknown>>("pianolog_read", { p_shape: "meta" }),
  ]);
  const m = (meta || {}) as Record<string, unknown>;
  return new Response(JSON.stringify({ ok: true, ran: last, last_sync: m.last_sync, sections: Array.isArray(m.sections) ? (m.sections as unknown[]).length : 0,
    roster_rows: Array.isArray(m.app_access) ? (m.app_access as unknown[]).length : 0, runs }), { headers });
};
