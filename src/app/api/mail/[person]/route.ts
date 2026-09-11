import { NextRequest, NextResponse } from "next/server";
import { listInbox, modifyThread } from "@/lib/gmail";
import { imapList, imapModify } from "@/lib/imapmail";
import { mailboxFor } from "@/lib/mailbox";
import { requireSession, jsonError } from "@/lib/api";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** GET one page of the person's Inbox (?page=<token>). */
export async function GET(req: NextRequest, ctx: { params: Promise<{ person: string }> }) {
  const guard = requireSession(req);
  if (guard) return guard;
  try {
    const { person } = await ctx.params;
    const box = mailboxFor(person);
    if ("error" in box) return NextResponse.json({ error: box.error }, { status: box.status });
    const pageToken = req.nextUrl.searchParams.get("page") || "";
    const page = box.kind === "imap" ? await imapList(pageToken) : await listInbox(box.user, pageToken);
    return NextResponse.json({ user: box.user, name: box.name, provider: box.kind, ...page });
  } catch (err) {
    return jsonError(err);
  }
}

/** POST { action: "read" | "unread" | "archive", threadIds: string[] } */
export async function POST(req: NextRequest, ctx: { params: Promise<{ person: string }> }) {
  const guard = requireSession(req);
  if (guard) return guard;
  try {
    const { person } = await ctx.params;
    const box = mailboxFor(person);
    if ("error" in box) return NextResponse.json({ error: box.error }, { status: box.status });
    const body = (await req.json()) as { action?: string; threadIds?: string[] };
    const ids = Array.isArray(body.threadIds) ? body.threadIds.filter((s) => typeof s === "string").slice(0, 50) : [];
    if (!ids.length) return NextResponse.json({ error: "threadIds[] required" }, { status: 400 });
    const action = body.action;
    if (action !== "read" && action !== "unread" && action !== "archive") {
      return NextResponse.json({ error: `Unknown action "${action}"` }, { status: 400 });
    }
    if (box.kind === "imap") {
      await imapModify(ids, action);
    } else {
      const [add, remove] = action === "read" ? [[], ["UNREAD"]] : action === "unread" ? [["UNREAD"], []] : [[], ["INBOX", "UNREAD"]];
      await Promise.all(ids.map((id) => modifyThread(box.user, id, add, remove)));
    }
    return NextResponse.json({ ok: true, changed: ids.length });
  } catch (err) {
    return jsonError(err);
  }
}
