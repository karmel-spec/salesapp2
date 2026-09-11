import crypto from "crypto";
import { config } from "./config";

/**
 * Gmail read access for the Team Inbox Board.
 *
 * The app's service account has Workspace domain-wide delegation for
 * gmail.modify + gmail.send, so it can act as any @brighamlarsonpianos.com
 * mailbox: we mint a JWT with `sub: <mailbox>` and exchange it for a token.
 * Nothing here reads message bodies — only INBOX counts and the From /
 * Subject / date of the oldest unread messages.
 */

const tokens = new Map<string, { token: string; exp: number }>();

async function tokenFor(user: string): Promise<string> {
  if (!config.googleClientEmail || !config.googlePrivateKey) {
    throw new Error("Google service account not configured");
  }
  const now = Math.floor(Date.now() / 1000);
  const cached = tokens.get(user);
  if (cached && cached.exp > now + 60) return cached.token;

  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const unsigned =
    b64({ alg: "RS256", typ: "JWT" }) +
    "." +
    b64({
      iss: config.googleClientEmail,
      sub: user,
      scope: "https://www.googleapis.com/auth/gmail.modify",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    });
  const signature = crypto.sign("RSA-SHA256", Buffer.from(unsigned), config.googlePrivateKey).toString("base64url");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${signature}` }),
  });
  const json = (await res.json()) as { access_token?: string; expires_in?: number; error?: string; error_description?: string };
  if (!json.access_token) {
    throw new Error(`Gmail access for ${user} refused: ${json.error || res.status} ${json.error_description || ""}`.trim());
  }
  tokens.set(user, { token: json.access_token, exp: now + (json.expires_in || 3600) });
  return json.access_token;
}

export interface MailItem {
  id: string;
  from: string; // display name (or address)
  subject: string;
  ageDays: number;
}

export interface MailboxSummary {
  user: string;
  total: number; // threads in Inbox
  unread: number; // unread threads in Inbox
  oldestDays: number | null; // age of the oldest unread message
  oldest: MailItem[]; // oldest unread first
  error?: string;
}

const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";

async function gget<T>(token: string, path: string): Promise<T> {
  const res = await fetch(`${GMAIL}${path}`, { headers: { authorization: `Bearer ${token}` } });
  const json = (await res.json()) as T & { error?: { message?: string; code?: number } };
  if (json.error) throw new Error(`Gmail ${json.error.code}: ${json.error.message}`);
  return json;
}

/** "Jane Doe <jane@x.com>" → "Jane Doe"; bare addresses stay as-is. */
function displayName(from: string): string {
  const m = from.match(/^\s*"?([^"<]+?)"?\s*<[^>]+>\s*$/);
  return (m ? m[1] : from).trim();
}

/* ───────────── Working a mailbox from the console ───────────── */

export interface ThreadSummary {
  id: string;
  from: string;
  subject: string;
  snippet: string;
  date: string; // ISO
  unread: boolean;
  count: number; // messages in thread
}

export interface MailMessage {
  id: string;
  from: string;
  fromAddress: string;
  to: string;
  date: string; // ISO
  subject: string;
  body: string; // plain text (HTML stripped when that's all there is)
  unread: boolean;
  messageIdHeader: string; // RFC Message-ID, for In-Reply-To
  references: string;
}

export interface ThreadDetail {
  id: string;
  subject: string;
  messages: MailMessage[];
}

const header = (m: { payload?: { headers?: { name: string; value: string }[] } }, n: string) =>
  m.payload?.headers?.find((h) => h.name.toLowerCase() === n.toLowerCase())?.value || "";

function addressOf(from: string): string {
  const m = from.match(/<([^>]+)>/);
  return (m ? m[1] : from).trim();
}

function decodeB64(s: string): string {
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>|<\/p>|<\/div>|<\/li>|<\/tr>|<\/h[1-6]>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

interface Part {
  mimeType?: string;
  body?: { data?: string; size?: number };
  parts?: Part[];
}

/** Prefer the text/plain part; fall back to stripped HTML. */
function bodyText(payload: Part | undefined): string {
  if (!payload) return "";
  let plain = "";
  let html = "";
  const walk = (p: Part) => {
    if (p.body?.data) {
      if (p.mimeType === "text/plain" && !plain) plain = decodeB64(p.body.data);
      else if (p.mimeType === "text/html" && !html) html = decodeB64(p.body.data);
    }
    p.parts?.forEach(walk);
  };
  walk(payload);
  return (plain || htmlToText(html)).trim();
}

/** One page of the Inbox, newest first (≈30 threads per page). */
export async function listInbox(user: string, pageToken = ""): Promise<{ threads: ThreadSummary[]; nextPageToken?: string }> {
  const token = await tokenFor(user);
  const list = await gget<{ threads?: { id: string }[]; nextPageToken?: string }>(
    token,
    `/threads?labelIds=INBOX&maxResults=30${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`
  );
  const threads = await Promise.all(
    (list.threads || []).map(async (t) => {
      const th = await gget<{
        messages?: { id: string; internalDate?: string; snippet?: string; labelIds?: string[]; payload?: { headers?: { name: string; value: string }[] } }[];
      }>(token, `/threads/${t.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`);
      const msgs = th.messages || [];
      const last = msgs[msgs.length - 1];
      const first = msgs[0];
      return {
        id: t.id,
        from: displayName(header(last || {}, "From")),
        subject: header(first || {}, "Subject") || "(no subject)",
        snippet: htmlToText(last?.snippet || ""),
        date: new Date(Number(last?.internalDate || Date.now())).toISOString(),
        unread: msgs.some((m) => m.labelIds?.includes("UNREAD")),
        count: msgs.length,
      };
    })
  );
  return { threads, nextPageToken: list.nextPageToken };
}

/** Every message in a thread, oldest first, as plain text. */
export async function getThread(user: string, threadId: string): Promise<ThreadDetail> {
  const token = await tokenFor(user);
  const th = await gget<{
    messages?: { id: string; internalDate?: string; labelIds?: string[]; payload?: Part & { headers?: { name: string; value: string }[] } }[];
  }>(token, `/threads/${threadId}?format=full`);
  const messages: MailMessage[] = (th.messages || []).map((m) => ({
    id: m.id,
    from: displayName(header(m, "From")),
    fromAddress: addressOf(header(m, "From")),
    to: header(m, "To"),
    date: new Date(Number(m.internalDate || Date.now())).toISOString(),
    subject: header(m, "Subject"),
    body: bodyText(m.payload),
    unread: Boolean(m.labelIds?.includes("UNREAD")),
    messageIdHeader: header(m, "Message-ID") || header(m, "Message-Id"),
    references: header(m, "References"),
  }));
  return { id: threadId, subject: messages[0]?.subject || "(no subject)", messages };
}

/** Add/remove labels on every message of a thread (read/unread, archive). */
export async function modifyThread(user: string, threadId: string, add: string[], remove: string[]): Promise<void> {
  const token = await tokenFor(user);
  const res = await fetch(`${GMAIL}/threads/${threadId}/modify`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ addLabelIds: add, removeLabelIds: remove }),
  });
  if (!res.ok) throw new Error(`Gmail modify failed (${res.status}): ${await res.text()}`);
}

/** Reply in-thread, sent as the mailbox owner. */
export async function sendReply(
  user: string,
  opts: { threadId: string; to: string; subject: string; body: string; inReplyTo?: string; references?: string; fromName?: string }
): Promise<{ id: string }> {
  const token = await tokenFor(user);
  const subject = /^re:/i.test(opts.subject) ? opts.subject : `Re: ${opts.subject}`;
  const lines = [
    `From: ${opts.fromName ? `"${opts.fromName.replace(/"/g, "")}" ` : ""}<${user}>`,
    `To: ${opts.to}`,
    `Subject: ${subject.replace(/[\r\n]+/g, " ")}`,
    opts.inReplyTo ? `In-Reply-To: ${opts.inReplyTo}` : "",
    opts.inReplyTo ? `References: ${[opts.references, opts.inReplyTo].filter(Boolean).join(" ")}` : "",
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    opts.body,
  ].filter((l, i) => l !== "" || i >= 8);
  const raw = Buffer.from(lines.join("\r\n"), "utf8").toString("base64url");
  const res = await fetch(`${GMAIL}/messages/send`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ raw, threadId: opts.threadId }),
  });
  const json = (await res.json()) as { id?: string; error?: { message?: string } };
  if (!res.ok || !json.id) throw new Error(`Gmail send failed: ${json.error?.message || res.status}`);
  return { id: json.id };
}

/**
 * Inbox counts plus the oldest unread messages. Pages through the unread
 * list (newest first) to find the oldest — Karmel's inbox has thousands.
 */
export async function mailboxSummary(user: string, sample = 5): Promise<MailboxSummary> {
  try {
    const token = await tokenFor(user);
    const label = await gget<{ threadsTotal?: number; threadsUnread?: number }>(token, "/labels/INBOX");

    let ids: string[] = [];
    let pageToken = "";
    for (let page = 0; page < 12; page++) {
      const list = await gget<{ messages?: { id: string }[]; nextPageToken?: string }>(
        token,
        `/messages?q=${encodeURIComponent("in:inbox is:unread")}&maxResults=500${pageToken ? `&pageToken=${pageToken}` : ""}`
      );
      ids = ids.concat((list.messages || []).map((m) => m.id));
      if (!list.nextPageToken) break;
      pageToken = list.nextPageToken;
    }
    const oldestIds = ids.slice(-sample).reverse(); // list is newest-first → last N are the oldest
    const oldest = await Promise.all(
      oldestIds.map(async (id) => {
        const m = await gget<{ internalDate?: string; payload?: { headers?: { name: string; value: string }[] } }>(
          token,
          `/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`
        );
        const hdr = (n: string) => m.payload?.headers?.find((h) => h.name.toLowerCase() === n.toLowerCase())?.value || "";
        return {
          id,
          from: displayName(hdr("From")),
          subject: hdr("Subject") || "(no subject)",
          ageDays: Math.max(0, Math.round((Date.now() - Number(m.internalDate || Date.now())) / 864e5)),
        };
      })
    );
    return {
      user,
      total: label.threadsTotal ?? 0,
      unread: label.threadsUnread ?? 0,
      oldestDays: oldest.length ? oldest[0].ageDays : null,
      oldest,
    };
  } catch (err) {
    return { user, total: 0, unread: 0, oldestDays: null, oldest: [], error: err instanceof Error ? err.message : String(err) };
  }
}
