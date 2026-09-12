/**
 * Read-only Gmail access as any @brighamlarsonpianos.com mailbox, via the
 * service account's domain-wide delegation (gmail.modify scope granted in
 * the Workspace admin console 2026-09-10). Used by the SalesCaptain poller
 * to read notification emails without any per-mailbox app password.
 */
import * as crypto from "node:crypto";
import { htmlToText } from "./salescaptain-alert";

const tokens = new Map<string, { token: string; exp: number }>();
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");

export async function gmailToken(user: string): Promise<string> {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || "";
  const key = (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
  if (!email || !key) throw new Error("GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY not set");
  const now = Math.floor(Date.now() / 1000);
  const c = tokens.get(user);
  if (c && c.exp > now + 60) return c.token;
  const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({ iss: email, sub: user, scope: "https://www.googleapis.com/auth/gmail.modify", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 })}`;
  const sig = crypto.sign("RSA-SHA256", Buffer.from(unsigned), key).toString("base64url");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${sig}` }),
  });
  const j = (await res.json()) as { access_token?: string; expires_in?: number; error?: string; error_description?: string };
  if (!j.access_token) throw new Error(`Gmail token for ${user}: ${j.error} ${j.error_description || ""}`);
  tokens.set(user, { token: j.access_token, exp: now + (j.expires_in || 3600) });
  return j.access_token;
}

const G = "https://gmail.googleapis.com/gmail/v1/users/me";
async function gget<T>(user: string, path: string): Promise<T> {
  const r = await fetch(`${G}${path}`, { headers: { authorization: `Bearer ${await gmailToken(user)}` } });
  const j = (await r.json()) as T & { error?: { code?: number; message?: string } };
  if (j.error) throw new Error(`Gmail ${j.error.code}: ${j.error.message}`);
  return j;
}

/** All message ids matching a Gmail search (follows pages; capped). */
export async function searchMessages(user: string, q: string, cap = 2000): Promise<string[]> {
  let ids: string[] = [];
  let page = "";
  do {
    const r = await gget<{ messages?: { id: string }[]; nextPageToken?: string }>(user, `/messages?q=${encodeURIComponent(q)}&maxResults=500${page ? `&pageToken=${page}` : ""}`);
    ids = ids.concat((r.messages || []).map((m) => m.id));
    page = r.nextPageToken || "";
  } while (page && ids.length < cap);
  return ids;
}

export interface AlertMail {
  id: string;
  rfcMessageId: string;
  subject: string;
  from: string;
  internalDate: number;
  text: string;
}

function decodeB64(s: string): string {
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}
interface Part { mimeType?: string; body?: { data?: string }; parts?: Part[] }
function bodyText(p?: Part): string {
  if (!p) return "";
  let plain = "", html = "";
  const walk = (x: Part) => {
    if (x.body?.data) {
      if (x.mimeType === "text/plain" && !plain) plain = decodeB64(x.body.data);
      else if (x.mimeType === "text/html" && !html) html = decodeB64(x.body.data);
    }
    x.parts?.forEach(walk);
  };
  walk(p);
  return plain.trim() || htmlToText(html);
}

/** One message with its text body and RFC Message-ID. */
export async function getMessage(user: string, id: string): Promise<AlertMail> {
  const m = await gget<{ id: string; internalDate?: string; payload?: Part & { headers?: { name: string; value: string }[] } }>(user, `/messages/${id}?format=full`);
  const h = (n: string) => m.payload?.headers?.find((x) => x.name.toLowerCase() === n.toLowerCase())?.value || "";
  return { id: m.id, rfcMessageId: h("Message-ID") || h("Message-Id"), subject: h("Subject"), from: h("From"), internalDate: Number(m.internalDate || 0), text: bodyText(m.payload) };
}
