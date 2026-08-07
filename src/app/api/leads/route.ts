import { NextRequest, NextResponse } from "next/server";
import { getLeads, createLead } from "@/lib/leads";
import { canWrite } from "@/lib/sheets";
import { requireSession, jsonError } from "@/lib/api";
import { notifyTelegram } from "@/lib/arnold";
import { sendSms } from "@/lib/comms";
import { config } from "@/lib/config";
import { isValidArnoldKey } from "@/lib/auth";

/** Brigham's cell — texted on every new lead entered in the app. */
const NEW_LEAD_ALERT_PHONE = "+18018300011";

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
    // Text Brigham the new-lead details.
    const name = `${body.firstName} ${body.lastName || ""}`.trim();
    const bits = [
      body.headline && `"${body.headline}"`,
      body.leadType && `Type: ${body.leadType}${body.pianoType ? ` · ${body.pianoType}` : ""}`,
      body.phone && `Phone: ${body.phone}`,
      body.score && `Heat: ${body.score}/10`,
      body.capturedBy && `Entered by ${body.capturedBy}`,
    ].filter(Boolean).join("\n");
    sendSms(
      NEW_LEAD_ALERT_PHONE,
      `🆕 New lead: ${name}\n${bits}\n${config.publicBaseUrl}/leads/${id}`
    ).catch(() => {});
    return NextResponse.json({ id }, { status: 201 });
  } catch (err) {
    return jsonError(err, 400);
  }
}
