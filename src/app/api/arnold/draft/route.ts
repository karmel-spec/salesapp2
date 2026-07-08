import { NextRequest, NextResponse } from "next/server";
import { getLead, saveDrafts, appendTimeline, type DraftMessage } from "@/lib/leads";
import { isValidArnoldKey } from "@/lib/auth";
import { hmacVerify } from "@/lib/arnold";
import { config } from "@/lib/config";
import { jsonError } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * Arnold's inbound webhook: the Hermes agent pushes AI-drafted outreach here.
 * Auth: draft-only key in `x-blp-key` AND (if a secret is set) HMAC signature
 * of the raw body in `x-blp-signature`. This key can ONLY set drafts — it is
 * rejected everywhere else in the app.
 *
 * Body: { leadId: string, drafts: [{channel: "sms"|"email", subject?, body}] }
 */
export async function POST(req: NextRequest) {
  try {
    const raw = await req.text();
    if (!isValidArnoldKey(req.headers.get("x-blp-key"))) {
      return NextResponse.json({ error: "Invalid Arnold key" }, { status: 401 });
    }
    if (config.arnoldWebhookSecret && !hmacVerify(raw, req.headers.get("x-blp-signature"), config.arnoldWebhookSecret)) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    const body = JSON.parse(raw) as {
      leadId?: string;
      drafts?: { channel: "sms" | "email"; subject?: string; body: string }[];
    };
    if (!body.leadId || !body.drafts?.length) {
      return NextResponse.json({ error: "leadId and drafts[] required" }, { status: 400 });
    }

    const found = await getLead(body.leadId);
    if (!found) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

    const now = new Date().toISOString();
    const incoming: DraftMessage[] = body.drafts
      .filter((d) => (d.channel === "sms" || d.channel === "email") && d.body?.trim())
      .map((d) => ({
        channel: d.channel,
        subject: d.subject,
        body: d.body.trim(),
        status: "pending" as const,
        createdAt: now,
        createdBy: "arnold",
      }));

    // Replace prior pending drafts from Arnold; keep sent/dismissed history.
    const kept = found.lead.drafts.filter((d) => d.status !== "pending");
    await saveDrafts(found.lead, found.shape, [...kept, ...incoming]);
    await appendTimeline(found.lead, found.shape, {
      at: now,
      who: "Arnold",
      kind: "draft",
      text: `Arnold suggested ${incoming.map((d) => d.channel).join(" + ")} drafts (awaiting approval)`,
    });
    return NextResponse.json({ ok: true, saved: incoming.length });
  } catch (err) {
    return jsonError(err);
  }
}
