import { NextRequest, NextResponse } from "next/server";
import { getLead, appendTimeline } from "@/lib/leads";
import { saveLeadPhoto } from "@/lib/media";
import { requireSession, jsonError } from "@/lib/api";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_BYTES = 3_500_000;
const ALLOWED =
  /^(image\/|application\/pdf$|text\/(plain|csv)$|audio\/|video\/mp4$|application\/(msword|vnd\.openxmlformats-officedocument\.(wordprocessingml\.document|spreadsheetml\.sheet)|vnd\.ms-excel)$)/;

/**
 * Attach a photo/file directly to a lead (no message involved). The file
 * lands in blob storage and a 📎 timeline event records it, so it shows in
 * the conversation, the activity log, and the lead's Files card.
 * Body: { name, type, dataBase64, who? }
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = requireSession(req);
  if (guard) return guard;
  try {
    const { id } = await ctx.params;
    const found = await getLead(id);
    if (!found) return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    const { lead, shape } = found;

    const input = (await req.json()) as { name?: string; type?: string; dataBase64?: string; who?: string };
    const type = (input.type || "").toLowerCase();
    const name = (input.name || "file").slice(0, 120);
    if (!input.dataBase64) return NextResponse.json({ error: "No file data" }, { status: 400 });
    if (!ALLOWED.test(type)) {
      return NextResponse.json({ error: "Unsupported file type — photos, PDFs, docs, audio, or video" }, { status: 400 });
    }
    const data = Buffer.from(input.dataBase64, "base64");
    if (data.length > MAX_BYTES) {
      return NextResponse.json({ error: "File too large — keep it under 3.5 MB" }, { status: 400 });
    }

    const stored = await saveLeadPhoto(lead.id, type, data);
    const who = input.who || "app";
    const isImage = type.startsWith("image/");
    await appendTimeline(lead, shape, {
      at: new Date().toISOString(),
      who,
      kind: "file",
      text:
        `📎 ${who} attached "${name}"\n` +
        (isImage ? `📷 Photo: ${stored.url}` : `📎 File: ${stored.url} (${name})`),
    });
    return NextResponse.json({ ok: true, url: stored.url });
  } catch (err) {
    return jsonError(err);
  }
}
