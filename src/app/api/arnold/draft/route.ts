import { NextRequest, NextResponse } from "next/server";
import { getLead, saveDrafts, appendTimeline, type DraftMessage } from "@/lib/leads";
import { isValidArnoldKey } from "@/lib/auth";
import { hmacVerify } from "@/lib/arnold";
import { config } from "@/lib/config";
import { jsonError } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * Arnold's inbound webhook: the Hermes agent pushes AI-drafted outreach here.
 * Auth: draft-only key in `x-blp-key` (required). If an HMAC signature is
 * also sent in `x-blp-signature`, it must verify. This key can ONLY set
 * drafts — it is rejected for every send/update endpoint.
 *
 * Body: { leadId: string, drafts: [{channel: "sms"|"text"|"email", subject?, body, note?}] }
 * ("text" is accepted as an alias for "sms" to match Arnold's older contract.)
 */
export async function POST(req: NextRequest) {
  try {
    const raw = await req.text();
    if (!isValidArnoldKey(req.headers.get("x-blp-key"))) {
      return NextResponse.json({ error: "Invalid Arnold key" }, { status: 401 });
    }
    const signature = req.headers.get("x-blp-signature");
    if (signature && !hmacVerify(raw, signature, config.arnoldWebhookSecret)) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    const body = JSON.parse(raw) as {
      leadId?: string;
      drafts?: { channel: string; subject?: string; body: string; note?: string }[];
    };
    if (!body.leadId || !body.drafts?.length) {
      return NextResponse.json({ error: "leadId and drafts[] required" }, { status: 400 });
    }

    const found = await getLead(body.leadId);
    if (!found) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

    const now = new Date().toISOString();
    const incoming: DraftMessage[] = body.drafts
      .map((d) => ({ ...d, channel: d.channel === "text" ? "sms" : d.channel }))
      .filter((d): d is typeof d & { channel: "sms" | "email" } =>
        (d.channel === "sms" || d.channel === "email") && Boolean(d.body?.trim())
      )
      .map((d) => ({
        channel: d.channel,
        subject: d.subject,
        body: d.body.trim(),
        note: d.note?.trim() || undefined,
        status: "pending" as const,
        createdAt: now,
        createdBy: "arnold",
      }));
    if (!incoming.length) {
      return NextResponse.json({ error: "No valid drafts (channel must be sms/text/email with a body)" }, { status: 400 });
    }

    // Replace prior pending drafts on the same channels; keep sent/dismissed
    // history and pending drafts for other channels.
    const channels = new Set(incoming.map((d) => d.channel));
    const kept = found.lead.drafts.filter((d) => d.status !== "pending" || !channels.has(d.channel));
    await saveDrafts(found.lead, found.shape, [...kept, ...incoming]);
    await appendTimeline(found.lead, found.shape, {
      at: now,
      who: "Arnold",
      kind: "draft",
      text: `Arnold suggested ${incoming.map((d) => d.channel).join(" + ")} draft(s) — awaiting approval${incoming[0].note ? ` (${incoming[0].note})` : ""}`,
    });
    return NextResponse.json({ ok: true, saved: incoming.length });
  } catch (err) {
    return jsonError(err);
  }
}
