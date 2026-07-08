import { NextRequest, NextResponse } from "next/server";
import { getLeads, createLead } from "@/lib/leads";
import { canWrite } from "@/lib/sheets";
import { requireSession, jsonError } from "@/lib/api";
import { notifyTelegram } from "@/lib/arnold";
import { config } from "@/lib/config";
import { isValidArnoldKey } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  // Arnold's draft-only key grants read access so he can survey the pipeline.
  const guard = requireSession(req);
  if (guard && !isValidArnoldKey(req.headers.get("x-blp-key"))) return guard;
  try {
    const force = req.nextUrl.searchParams.get("refresh") === "1";
    const { leads } = await getLeads(force);
    return NextResponse.json({ leads, writeEnabled: canWrite() });
  } catch (err) {
    return jsonError(err);
  }
}

export async function POST(req: NextRequest) {
  const guard = requireSession(req);
  if (guard) return guard;
  try {
    const body = await req.json();
    if (!body.firstName?.trim()) {
      return NextResponse.json({ error: "First name is required" }, { status: 400 });
    }
    const id = await createLead(body);
    // Fire-and-forget team ping about the new lead.
    notifyTelegram(
      `🎹 <b>New lead</b>: ${body.firstName} ${body.lastName || ""}\n${body.headline || ""}\nAssigned to ${config.defaultRep}`
    ).catch(() => {});
    return NextResponse.json({ id }, { status: 201 });
  } catch (err) {
    return jsonError(err, 400);
  }
}
