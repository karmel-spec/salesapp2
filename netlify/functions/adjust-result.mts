/**
 * Polling endpoint for the Planner's background AI jobs (schedule-adjust,
 * bottleneck-resolve). Those run as Netlify background functions and write
 * their result to the "adjust-results" blob store under the caller's nonce;
 * this returns it — {pending:true} with 202 until the job lands.
 */
import { getStore } from "@netlify/blobs";

const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type",
  "access-control-allow-methods": "GET, OPTIONS" };

export default async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("", { headers: CORS });
  const nonce = new URL(req.url).searchParams.get("nonce") || "";
  if (!/^[\w-]{8,80}$/.test(nonce)) return json({ error: "bad nonce" }, 400);
  try {
    const v = await getStore("adjust-results").get(nonce, { type: "json" });
    return v ? json(v) : json({ pending: true }, 202);
  } catch (e: any) {
    return json({ error: String(e.message || e) }, 500);
  }
};
function json(o: unknown, status = 200) {
  return new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", ...CORS } });
}
