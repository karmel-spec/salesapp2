import { NextRequest, NextResponse } from "next/server";
import { listTemplates, addTemplate } from "@/lib/templates";
import { requireSession, jsonError } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const guard = requireSession(req);
  if (guard) return guard;
  try {
    return NextResponse.json({ templates: await listTemplates() });
  } catch (err) {
    return jsonError(err);
  }
}

export async function POST(req: NextRequest) {
  const guard = requireSession(req);
  if (guard) return guard;
  try {
    const body = await req.json();
    if (!body.name?.trim() || !body.body?.trim()) {
      return NextResponse.json({ error: "Template name and message are required" }, { status: 400 });
    }
    const channel = ["sms", "email", "both"].includes(body.channel) ? body.channel : "both";
    const t = await addTemplate({
      name: body.name,
      channel,
      subject: body.subject,
      body: body.body,
      who: body.who || "team",
    });
    return NextResponse.json({ ok: true, template: t });
  } catch (err) {
    return jsonError(err);
  }
}
