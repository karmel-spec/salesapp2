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
