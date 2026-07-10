import { NextRequest, NextResponse } from "next/server";
import { getLead, appendTimeline } from "@/lib/leads";
import { notifyTelegram, notifyArnoldWebhook } from "@/lib/arnold";
import { requireSession, jsonError } from "@/lib/api";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * "Instructions for Arnold" — a rep tells Arnold what to do next on this
 * lead. Recorded on the timeline (kind "followup": binding instructions his
 * drafting obeys), pinged to Telegram, and delivered to his brain so pending
 * drafts get rewritten around it.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = requireSession(req);
  if (guard) return guard;
  try {
    const { id } = await ctx.params;
    const found = await getLead(id, true);
    if (!found) return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    const { lead, shape } = found;

    const body = (await req.json()) as { text?: string; who?: string };
    const text = (body.text || "").trim();
    const who = body.who || "app";
    if (!text) return NextResponse.json({ error: "Instructions are empty" }, { status: 400 });

    await appendTimeline(lead, shape, {
      at: new Date().toISOString(),
      who,
      kind: "followup",
      text,
    });

    notifyTelegram(
      `📋 <b>${who} → Arnold</b> on ${lead.name} (${lead.headline || lead.leadType || "lead"}):\n"${text.slice(0, 500)}"`
    ).catch(() => {});

    const ping = await notifyArnoldWebhook({
      event: "followup_instruction",
      lead: { id: lead.id },
      note:
        `${who} left instructions for ${lead.name}: "${text}". These outrank generic strategy — ` +
        `rewrite any pending drafts for this lead to follow them, and note anything you can't do.`,
    }).catch(() => ({ ok: false, detail: "webhook unreachable" }));

    return NextResponse.json({
      ok: true,
      detail: ping.ok
        ? "Instructions recorded — Arnold has them and is updating his drafts."
        : "Instructions recorded on the lead — Arnold picks them up on his next pass (his brain wasn't reachable right now).",
    });
  } catch (err) {
    return jsonError(err);
  }
}
