import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { createTransport } from "nodemailer";
import type { MailboxSummary, ThreadSummary, ThreadDetail, MailMessage } from "./gmail";

/**
 * Personal-Gmail mailbox (BLP Email, brighamlarsonpianos@gmail.com) worked
 * over IMAP + SMTP with a Google App Password. Workspace delegation can't
 * cover a personal account, and OAuth for Gmail's restricted scopes would
 * either need Google's app verification or expire weekly in testing mode —
 * an app password has neither problem.
 *
 * Env: BLP_GMAIL_USER (default brighamlarsonpianos@gmail.com),
 *      BLP_GMAIL_APP_PASSWORD (16-char app password, 2-Step Verification on).
 *
 * IMAP has no thread objects, so each message stands in for a "thread"
 * (id = IMAP UID). Same shapes as gmail.ts so the UI doesn't care.
 */

export const IMAP_USER = process.env.BLP_GMAIL_USER || "brighamlarsonpianos@gmail.com";
const PASS = process.env.BLP_GMAIL_APP_PASSWORD || "";

export function imapConfigured(): boolean {
  return Boolean(PASS);
}

async function withClient<T>(fn: (c: ImapFlow) => Promise<T>): Promise<T> {
  if (!PASS) throw new Error("BLP Email isn't connected yet — add BLP_GMAIL_APP_PASSWORD (a Google App Password) in Netlify.");
  const client = new ImapFlow({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: { user: IMAP_USER, pass: PASS },
    logger: false,
  });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.logout().catch(() => {});
  }
}

const toDate = (d: string | Date | undefined): Date | undefined => {
  if (!d) return undefined;
  const dt = d instanceof Date ? d : new Date(d);
  return isNaN(dt.getTime()) ? undefined : dt;
};
const iso = (d: string | Date | undefined) => (toDate(d) || new Date()).toISOString();
const ageDays = (d: string | Date | undefined) => Math.max(0, Math.round((Date.now() - (toDate(d)?.getTime() || Date.now())) / 864e5));
const nameOf = (addr?: { name?: string; address?: string }) => addr?.name?.trim() || addr?.address || "(unknown)";

/** Inbox counts + the oldest unread messages (same shape as the Gmail API summary). */
export async function imapSummary(sample = 5): Promise<MailboxSummary> {
  try {
    return await withClient(async (c) => {
      const lock = await c.getMailboxLock("INBOX");
      try {
        const status = await c.status("INBOX", { messages: true, unseen: true });
        const unseen = (await c.search({ seen: false })) as number[];
        const oldestUids = [...unseen].sort((a, b) => a - b).slice(0, sample); // low UID = oldest
        const oldest: MailboxSummary["oldest"] = [];
        for await (const m of c.fetch(oldestUids.length ? oldestUids : [], { uid: true, envelope: true, internalDate: true })) {
          oldest.push({
            id: String(m.uid),
            from: nameOf(m.envelope?.from?.[0]),
            subject: m.envelope?.subject || "(no subject)",
            ageDays: ageDays(m.internalDate),
          });
        }
        oldest.sort((a, b) => b.ageDays - a.ageDays);
        return { user: IMAP_USER, total: status.messages ?? 0, unread: status.unseen ?? unseen.length, oldestDays: oldest[0]?.ageDays ?? null, oldest };
      } finally {
        lock.release();
      }
    });
  } catch (err) {
    return { user: IMAP_USER, total: 0, unread: 0, oldestDays: null, oldest: [], error: err instanceof Error ? err.message : String(err) };
  }
}

/** Newest 30 inbox messages; `page` = "before UID" for older ones. */
export async function imapList(page = ""): Promise<{ threads: ThreadSummary[]; nextPageToken?: string }> {
  return withClient(async (c) => {
    const lock = await c.getMailboxLock("INBOX");
    try {
      const all = ((await c.search({ all: true })) as number[]).sort((a, b) => b - a); // newest first
      const start = page ? all.findIndex((u) => u < Number(page)) : 0;
      const slice = start < 0 ? [] : all.slice(start, start + 30);
      const threads: ThreadSummary[] = [];
      if (slice.length) {
        for await (const m of c.fetch(slice, { uid: true, envelope: true, internalDate: true, flags: true })) {
          threads.push({
            id: String(m.uid),
            from: nameOf(m.envelope?.from?.[0]),
            subject: m.envelope?.subject || "(no subject)",
            snippet: "",
            date: iso(m.internalDate),
            unread: !(m.flags?.has("\\Seen") ?? false),
            count: 1,
          });
        }
      }
      threads.sort((a, b) => Number(b.id) - Number(a.id));
      const last = slice[slice.length - 1];
      return { threads, nextPageToken: slice.length === 30 && last ? String(last) : undefined };
    } finally {
      lock.release();
    }
  });
}

/** One message, parsed to plain text. */
export async function imapGet(uid: string): Promise<ThreadDetail> {
  return withClient(async (c) => {
    const lock = await c.getMailboxLock("INBOX");
    try {
      const dl = await c.download(uid, undefined, { uid: true });
      const chunks: Buffer[] = [];
      for await (const ch of dl.content) chunks.push(Buffer.from(ch));
      const parsed = await simpleParser(Buffer.concat(chunks));
      const fromAddr = parsed.from?.value?.[0];
      const toText = Array.isArray(parsed.to) ? parsed.to.map((t) => t.text).join(", ") : parsed.to?.text || "";
      const flags = await c.fetchOne(uid, { flags: true }, { uid: true });
      const msg: MailMessage = {
        id: uid,
        from: nameOf(fromAddr),
        fromAddress: fromAddr?.address || "",
        to: toText,
        date: iso(parsed.date || undefined),
        subject: parsed.subject || "(no subject)",
        body: (parsed.text || (parsed.html ? htmlToText(String(parsed.html)) : "")).trim(),
        unread: !(flags && flags.flags?.has("\\Seen")),
        messageIdHeader: parsed.messageId || "",
        references: Array.isArray(parsed.references) ? parsed.references.join(" ") : parsed.references || "",
      };
      return { id: uid, subject: msg.subject, messages: [msg] };
    } finally {
      lock.release();
    }
  });
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

/** read / unread / archive (archive = move out of INBOX into All Mail). */
export async function imapModify(uids: string[], action: "read" | "unread" | "archive"): Promise<void> {
  await withClient(async (c) => {
    const lock = await c.getMailboxLock("INBOX");
    try {
      const range = uids.join(",");
      if (action === "read") await c.messageFlagsAdd(range, ["\\Seen"], { uid: true });
      else if (action === "unread") await c.messageFlagsRemove(range, ["\\Seen"], { uid: true });
      else {
        await c.messageFlagsAdd(range, ["\\Seen"], { uid: true });
        await c.messageMove(range, "[Gmail]/All Mail", { uid: true });
      }
    } finally {
      lock.release();
    }
  });
}

/** Reply over SMTP as the personal account, threaded with In-Reply-To. */
export async function imapReply(opts: { to: string; subject: string; body: string; inReplyTo?: string; references?: string; fromName?: string }): Promise<{ id: string }> {
  if (!PASS) throw new Error("BLP Email isn't connected yet");
  const transport = createTransport({ host: "smtp.gmail.com", port: 465, secure: true, auth: { user: IMAP_USER, pass: PASS } });
  const subject = /^re:/i.test(opts.subject) ? opts.subject : `Re: ${opts.subject}`;
  const info = await transport.sendMail({
    from: opts.fromName ? `"${opts.fromName.replace(/"/g, "")}" <${IMAP_USER}>` : IMAP_USER,
    to: opts.to,
    subject,
    text: opts.body,
    inReplyTo: opts.inReplyTo || undefined,
    references: [opts.references, opts.inReplyTo].filter(Boolean).join(" ") || undefined,
  });
  return { id: info.messageId || "sent" };
}
