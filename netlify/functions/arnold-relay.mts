/** Diagnostic relay: re-send (or test) a signed webhook from Netlify to Arnold's
 *  Hermes gateway, exactly the way the console does it. Returns what the
 *  gateway answered, so a failing Netlify → Cloudflare → gateway path is
 *  visible instead of silent.
 *  POST /.netlify/functions/arnold-relay?key=<BLP app key>  body = the JSON event to send */
import * as crypto from "node:crypto";

const APP_KEY = process.env.BLP_APP_ACCESS_KEY || "pianoman";
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o, null, 1), { status, headers: { "content-type": "application/json" } });

export default async (req: Request) => {
  const url = new URL(req.url);
  if (url.searchParams.get("key") !== APP_KEY) return json({ error: "unauthorized" }, 403);
  const target = process.env.ARNOLD_WEBHOOK_URL || "";
  const secret = process.env.ARNOLD_WEBHOOK_SECRET || "";
  if (!target || !secret) return json({ error: "ARNOLD_WEBHOOK_URL / ARNOLD_WEBHOOK_SECRET not set" }, 500);
  let payload: Record<string, unknown> = {};
  try { payload = req.method === "POST" ? ((await req.json()) as Record<string, unknown>) : {}; } catch { return json({ error: "body must be JSON" }, 400); }
  const body = JSON.stringify({ ...payload, channel: payload.channel || "auto", source: "blp-sales-app", at: new Date().toISOString() });
  const sig = `sha256=${crypto.createHmac("sha256", secret).update(body).digest("hex")}`;
  const t0 = Date.now();
  try {
    const r = await fetch(target, { method: "POST", headers: { "content-type": "application/json", "X-Hub-Signature-256": sig }, body, signal: AbortSignal.timeout(20_000) });
    const text = await r.text();
    return json({ ok: r.ok, status: r.status, ms: Date.now() - t0, server: r.headers.get("server"), cfRay: r.headers.get("cf-ray"), body: text.slice(0, 600) });
  } catch (e) {
    return json({ ok: false, error: String(e).slice(0, 300), ms: Date.now() - t0 });
  }
};
