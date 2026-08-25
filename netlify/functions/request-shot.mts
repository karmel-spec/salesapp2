/**
 * Screenshot upload for the Store Map suggestion box. The bridge web app runs
 * as an anonymous-access deployment whose OAuth token has no Drive scope, so
 * its own upload silently failed and every attached screenshot was lost.
 * This uploads through the service account instead, into the link-viewable
 * "BLP App Request Screenshots" folder, and returns the view link the client
 * then files with the request.
 *
 *   POST {key, id, photo: <base64>, photoType?, photoName?} → {ok, url}
 */
import * as crypto from "node:crypto";

const FOLDER_ID = "1AAr0c7oa4rM8sPmeVkPJ2yeIIylP4oYa";
const APP_KEY = process.env.BLP_APP_ACCESS_KEY || "pianoman";
const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type",
  "access-control-allow-methods": "POST, OPTIONS" };

let tokenCache: { token: string; exp: number } | null = null;
async function token(): Promise<string> {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || "";
  const key = (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
  const now = Math.floor(Date.now() / 1000);
  if (tokenCache && tokenCache.exp > now + 60) return tokenCache.token;
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const header = b64({ alg: "RS256", typ: "JWT" });
  const claims = b64({ iss: email, scope: "https://www.googleapis.com/auth/drive",
    aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 });
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  const signature = signer.sign(key).toString("base64url");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${header}.${claims}.${signature}` }) });
  const json = (await res.json()) as { access_token: string; expires_in: number };
  tokenCache = { token: json.access_token, exp: now + json.expires_in };
  return json.access_token;
}

export default async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  let body: any;
  try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }
  if ((body.key || "") !== APP_KEY) return json({ error: "unauthorized" }, 403);
  const photo = String(body.photo || "");
  if (!photo) return json({ error: "photo required" }, 400);
  if (photo.length > 8_000_000) return json({ error: "screenshot too large" }, 413);
  const name = (String(body.id || "shot") + "-" + String(body.photoName || "screenshot.jpg"))
    .replace(/[^\w.-]+/g, "_").slice(0, 80);
  try {
    const t = await token();
    const boundary = "blpshot" + Date.now().toString(36);
    const payload = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`
        + JSON.stringify({ name, parents: [FOLDER_ID] })
        + `\r\n--${boundary}\r\nContent-Type: ${String(body.photoType || "image/jpeg")}\r\n\r\n`),
      Buffer.from(photo, "base64"),
      Buffer.from(`\r\n--${boundary}--`),
    ]);
    const r = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink", {
      method: "POST",
      headers: { Authorization: `Bearer ${t}`, "Content-Type": `multipart/related; boundary=${boundary}` },
      body: payload,
    });
    const f = (await r.json()) as any;
    if (!f.id) return json({ error: "Drive upload failed: " + JSON.stringify(f).slice(0, 200) }, 502);
    // folder is anyone-with-link viewer, so the file inherits view access
    return json({ ok: true, url: f.webViewLink || `https://drive.google.com/file/d/${f.id}/view` });
  } catch (e: any) {
    return json({ error: String(e?.message || e) }, 502);
  }
};
function json(o: unknown, status = 200) {
  return new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", ...CORS } });
}
