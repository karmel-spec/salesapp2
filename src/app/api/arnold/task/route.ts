import { NextRequest, NextResponse } from "next/server";
import { notifyArnoldWebhook, notifyTelegram } from "@/lib/arnold";
import { requireSession, jsonError } from "@/lib/api";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Assign Arnold a free-form task from the console. Delivered to his Hermes
 * brain via the signed webhook; he reports back in the BLP Sales Team group.
 */
export async function POST(req: NextRequest) {
  const guard = requireSession(req);
  if (guard) return guard;
  try {
    const { task, who } = (await req.json()) as { task?: string; who?: string };
    if (!task?.trim()) return NextResponse.json({ error: "Write the task first" }, { status: 400 });

    const ping = await notifyArnoldWebhook({
      event: "team_task",
      note: `Task from ${who || "the team"} via the Sales Console: ${task.trim()}`,
    });
    if (!ping.ok) {
      return NextResponse.json(
        { error: `Arnold's brain is unreachable right now (${ping.detail}). His Mac may be asleep — you can also message @arnoldlarsonbot on Telegram.` },
        { status: 502 }
      );
    }
    notifyTelegram(`📋 <b>${who || "The team"} assigned Arnold a task</b> via the Sales Console:\n"${task.trim().slice(0, 500)}"`).catch(() => {});
    return NextResponse.json({ ok: true, detail: "Task delivered to Arnold — watch the BLP Sales Team group for his report." });
  } catch (err) {
    return jsonError(err);
  }
}
