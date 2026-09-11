import { NextRequest, NextResponse } from "next/server";
import { getThread, sendReply, modifyThread } from "@/lib/gmail";
import { mailboxFor as resolveMailbox } from "@/lib/mailbox";
import { requireSession, jsonError } from "@/lib/api";
import { config } from "@/lib/config";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function mailboxFor(key: string) {
  const box = resolveMailbox(key);
  return "error" in box ? null : box;
}

/** GET the full thread (plain-text bodies). Opening a thread marks it read. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ person: string; thread: string }> }) {
  const guard = requireSession(req);
  if (guard) return guard;
  try {
    const { person, thread } = await ctx.params;
    const box = mailboxFor(person);
    if (!box) return NextResponse.json({ error: "No connected mailbox for that person" }, { status: 404 });
    const detail = await getThread(box.user, thread);
    if (detail.messages.some((m) => m.unread)) {
      modifyThread(box.user, thread, [], ["UNREAD"]).catch(() => {});
      detail.messages = detail.messages.map((m) => ({ ...m, unread: false }));
    }
    return NextResponse.json({ user: box.user, ...detail });
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
    if (!box) return NextResponse.json({ error: "No connected mailbox for that person" }, { status: 404 });
    const input = (await req.json()) as { body?: string; who?: string };
    const body = (input.body || "").trim();
    if (!body) return NextResponse.json({ error: "Reply is empty" }, { status: 400 });

    const detail = await getThread(box.user, thread);
    // Reply to the most recent message that isn't from this mailbox.
    const last = [...detail.messages].reverse().find((m) => m.fromAddress.toLowerCase() !== box.user.toLowerCase()) || detail.messages[detail.messages.length - 1];
    if (!last) return NextResponse.json({ error: "Thread has no messages" }, { status: 400 });

    if (config.dryRunSends) {
      console.log(`[DRY-RUN] Gmail reply as ${box.user} to ${last.fromAddress} in ${thread}: ${body.slice(0, 80)}`);
      return NextResponse.json({ ok: true, dryRun: true, to: last.fromAddress });
    }
    const sent = await sendReply(box.user, {
      threadId: thread,
      to: last.fromAddress,
      subject: detail.subject,
      body: `${body}\n\n— ${input.who && input.who !== "app" ? input.who : box.name}, Brigham Larson Pianos`,
      inReplyTo: last.messageIdHeader,
      references: last.references,
      fromName: `${box.name} · Brigham Larson Pianos`,
    });
    return NextResponse.json({ ok: true, id: sent.id, to: last.fromAddress });
  } catch (err) {
    return jsonError(err);
  }
}
