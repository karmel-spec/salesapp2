import { NextRequest, NextResponse } from "next/server";
import { getThread, sendReply, modifyThread } from "@/lib/gmail";
import { imapGet, imapModify, imapReply } from "@/lib/imapmail";
import { mailboxFor } from "@/lib/mailbox";
import { requireSession, jsonError } from "@/lib/api";
import { config } from "@/lib/config";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** GET the full thread (plain-text bodies). Opening a thread marks it read. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ person: string; thread: string }> }) {
  const guard = requireSession(req);
  if (guard) return guard;
  try {
    const { person, thread } = await ctx.params;
    const box = mailboxFor(person);
    if ("error" in box) return NextResponse.json({ error: box.error }, { status: box.status });
    const detail = box.kind === "imap" ? await imapGet(thread) : await getThread(box.user, thread);
    if (detail.messages.some((m) => m.unread)) {
      (box.kind === "imap" ? imapModify([thread], "read") : modifyThread(box.user, thread, [], ["UNREAD"])).catch(() => {});
      detail.messages = detail.messages.map((m) => ({ ...m, unread: false }));
    }
    return NextResponse.json({ user: box.user, provider: box.kind, ...detail });
  } catch (err) {
    return jsonError(err);
  }
}

/** POST { body, who } — reply to the latest message in the thread, sent as the mailbox owner. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ person: string; thread: string }> }) {
  const guard = requireSession(req);
  if (guard) return guard;
  try {
    const { person, thread } = await ctx.params;
    const box = mailboxFor(person);
    if ("error" in box) return NextResponse.json({ error: box.error }, { status: box.status });
    const input = (await req.json()) as { body?: string; who?: string };
    const body = (input.body || "").trim();
    if (!body) return NextResponse.json({ error: "Reply is empty" }, { status: 400 });

    const detail = box.kind === "imap" ? await imapGet(thread) : await getThread(box.user, thread);
    // Reply to the most recent message that isn't from this mailbox.
    const last = [...detail.messages].reverse().find((m) => m.fromAddress.toLowerCase() !== box.user.toLowerCase()) || detail.messages[detail.messages.length - 1];
    if (!last) return NextResponse.json({ error: "Thread has no messages" }, { status: 400 });

    const signed = `${body}\n\n— ${input.who && input.who !== "app" ? input.who : box.name}, Brigham Larson Pianos`;
    if (config.dryRunSends) {
      console.log(`[DRY-RUN] ${box.kind} reply as ${box.user} to ${last.fromAddress} in ${thread}: ${body.slice(0, 80)}`);
      return NextResponse.json({ ok: true, dryRun: true, to: last.fromAddress });
    }
    const fromName = `${box.name} · Brigham Larson Pianos`;
    const sent =
      box.kind === "imap"
        ? await imapReply({ to: last.fromAddress, subject: detail.subject, body: signed, inReplyTo: last.messageIdHeader, references: last.references, fromName })
        : await sendReply(box.user, { threadId: thread, to: last.fromAddress, subject: detail.subject, body: signed, inReplyTo: last.messageIdHeader, references: last.references, fromName });
    return NextResponse.json({ ok: true, id: sent.id, to: last.fromAddress });
  } catch (err) {
    return jsonError(err);
  }
}
