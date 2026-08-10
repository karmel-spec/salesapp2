/**
 * Adjustment history for the Shop Manager Planner — returns the
 * "Adjustment Log" tab (newest first) so Brigham can see every past
 * "Apply adjustments" / bottleneck-answer run: what he wrote, what Claude
 * changed, which standing rules were remembered, and whether the revised
 * plan saved to the bridge.
 *
 *   GET ?key=<app key>&limit=50 → {ok, rows: [[when,by,kind,input,outcome,rules,questions,saved], …]}
 *
 * Simple GET with a query key (no custom headers) so there is no CORS
 * preflight — same pattern as the cleaning endpoints.
 */
import { readAdjustLog } from "./lib/adjust-log";

const APP_KEY = process.env.BLP_APP_ACCESS_KEY || "pianoman";

export default async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("", { headers: CORS });
  const u = new URL(req.url);
  if ((u.searchParams.get("key") || "") !== APP_KEY) return json({ error: "unauthorized" }, 403);
  const limit = Math.min(Math.max(parseInt(u.searchParams.get("limit") || "50", 10) || 50, 1), 200);
  try {
    return json({ ok: true, rows: await readAdjustLog(limit) });
  } catch (e: any) {
    return json({ error: String(e?.message || e) }, 502);
  }
};
const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type",
  "access-control-allow-methods": "GET, OPTIONS" };
function json(o: unknown, status = 200) {
  return new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", ...CORS } });
}
