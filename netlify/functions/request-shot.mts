/**
 * Screenshot storage for the Store Map suggestion box. The bridge web app's
 * anonymous deployment has no Drive scope (its own upload silently failed and
 * every attached screenshot was lost), and service accounts can't own My Drive
 * files anymore — so screenshots live in Netlify Blobs instead and are served
 * straight back out of this same function.
 *
 *   POST {key, id, photo: <base64>, photoType?, photoName?} → {ok, url}
 *   GET  ?id=<key>                                          → the image
 */
import * as crypto from "node:crypto";
import { getStore } from "@netlify/blobs";

const APP_KEY = process.env.BLP_APP_ACCESS_KEY || "pianoman";
const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type",
  "access-control-allow-methods": "GET, POST, OPTIONS" };

export default async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("", { headers: CORS });
  const store = getStore("request-shots");

  if (req.method === "GET") {
    const id = new URL(req.url).searchParams.get("id") || "";
    if (!/^[\w-]{8,80}$/.test(id)) return json({ error: "bad id" }, 400);
    const blob = await store.get(id, { type: "arrayBuffer" });
    if (!blob) return json({ error: "not found" }, 404);
    const meta = ((await store.getMetadata(id))?.metadata || {}) as any;
    return new Response(blob, { headers: { ...CORS,
      "content-type": String(meta.contentType || "image/jpeg"),
      "cache-control": "public, max-age=31536000, immutable" } });
  }

  if (req.method !== "POST") return json({ error: "GET or POST" }, 405);
  let body: any;
  try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }
  if ((body.key || "") !== APP_KEY) return json({ error: "unauthorized" }, 403);
  const photo = String(body.photo || "");
  if (!photo) return json({ error: "photo required" }, 400);
  if (photo.length > 8_000_000) return json({ error: "screenshot too large" }, 413);
  const id = String(body.id || "shot").replace(/[^\w-]+/g, "").slice(0, 30)
    + "-" + crypto.randomBytes(9).toString("base64url");
  await store.set(id, Buffer.from(photo, "base64"), {
    metadata: { contentType: String(body.photoType || "image/jpeg"),
                name: String(body.photoName || "screenshot.jpg").slice(0, 80) } });
  return json({ ok: true,
    url: "https://blpsalesapp.netlify.app/.netlify/functions/request-shot?id=" + id });
};
function json(o: unknown, status = 200) {
  return new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", ...CORS } });
}
