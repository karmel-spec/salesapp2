import { NextRequest, NextResponse } from "next/server";
import { getLead, saveBrief, type LeadBrief } from "@/lib/leads";
import { generateBriefViaApi } from "@/lib/arnold";
import { requireSession, jsonError } from "@/lib/api";
import { config } from "@/lib/config";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The Summary Bar's briefing — written by ARNOLD (the same engine that
 * drafts his outreach) and CACHED on the lead's row (brief_json). It only
 * regenerates when the timeline has moved since the cached version, so
 * page loads stay fast and cheap.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = requireSession(req);
  if (guard) return guard;
  try {
    const { id } = await ctx.params;
    const found = await getLead(id);
    if (!found) return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    const { lead, shape } = found;

    const asOf = lead.timeline[lead.timeline.length - 1]?.at || "empty";
    if (lead.brief && lead.brief.asOf === asOf && lead.brief.leftOff) {
      return NextResponse.json({ brief: lead.brief, cached: true });
    }
    if (!config.anthropicApiKey) {
      return NextResponse.json({ brief: null, reason: "ANTHROPIC_API_KEY not configured" });
    }

    const generated = await generateBriefViaApi(lead);
    const brief: LeadBrief = { ...generated, asOf };
    await saveBrief(lead, shape, brief);
    return NextResponse.json({ brief, cached: false });
  } catch (err) {
    return jsonError(err);
  }
}
