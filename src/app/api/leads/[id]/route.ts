import { NextRequest, NextResponse } from "next/server";
import { getLead, updateLeadFields, appendTimeline, COLS } from "@/lib/leads";
import { requireSession, jsonError } from "@/lib/api";
import { isValidArnoldKey } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  // Arnold's draft-only key grants read access (he re-reads leads pre-draft).
  const guard = requireSession(req);
  if (guard && !isValidArnoldKey(req.headers.get("x-blp-key"))) return guard;
  try {
    const { id } = await ctx.params;
    const found = await getLead(id);
    if (!found) return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    return NextResponse.json({ lead: found.lead });
  } catch (err) {
    return jsonError(err);
  }
}

const EDITABLE: (keyof typeof COLS)[] = [
  "status", "rep", "headline", "score", "firstName", "lastName", "notes",
  "phone", "email", "social", "source", "inquiryMethod", "leadType",
  "pianoType", "value", "lastContact",
];

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = requireSession(req);
  if (guard) return guard;
  try {
    const { id } = await ctx.params;
    const found = await getLead(id);
    if (!found) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

    const body = (await req.json()) as { fields?: Record<string, string>; who?: string };
    const fields: Partial<Record<keyof typeof COLS, string>> = {};
    for (const [k, v] of Object.entries(body.fields || {})) {
      if (EDITABLE.includes(k as keyof typeof COLS)) fields[k as keyof typeof COLS] = v;
    }
    if (!Object.keys(fields).length) {
      return NextResponse.json({ error: "No editable fields provided" }, { status: 400 });
    }
    await updateLeadFields(found.lead, found.shape, fields);
    await appendTimeline(found.lead, found.shape, {
      at: new Date().toISOString(),
      who: body.who || "app",
      kind: "edit",
      text: `Updated ${Object.keys(fields).join(", ")}`,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return jsonError(err);
  }
}
