/**
 * CORS-safe front door for the Planner's background AI jobs. Browsers can't
 * POST directly to Netlify BACKGROUND functions cross-origin (the platform
 * answers the preflight with an empty 202 and no CORS headers), so the UI
 * posts here — a normal sync function — and this relays server-side to the
 * background function, which ACKs 202 immediately. Results still flow
 * through the "adjust-results" blob store via adjust-result?nonce=…
 *
 *   POST {fn: "schedule"|"bottleneck", payload: {...}} → {ok, nonce}
 */
const FNS: Record<string, string> = {
  schedule: "schedule-adjust-background",
  bottleneck: "bottleneck-resolve-background",
};
const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type",
  "access-control-allow-methods": "POST, OPTIONS" };

export default async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  let body: any;
  try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }
  const fn = FNS[String(body.fn || "")];
  if (!fn) return json({ error: "fn must be schedule|bottleneck" }, 400);
  const payload = body.payload || {};
  if (!payload.nonce) return json({ error: "payload.nonce required" }, 400);
  const base = new URL(req.url).origin;
  const r = await fetch(`${base}/.netlify/functions/${fn}`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify(payload) });
  return json({ ok: r.status < 400, relayed: r.status, nonce: payload.nonce },
    r.status < 400 ? 200 : 502);
};
function json(o: unknown, status = 200) {
  return new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", ...CORS } });
}
