import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getLead, appendTimeline } from "@/lib/leads";
import { config } from "@/lib/config";
import { sendSms, sendEmail } from "@/lib/comms";
import { saveLeadPhoto } from "@/lib/media";
import { requireSession, jsonError } from "@/lib/api";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_PHOTO_BYTES = 3_500_000; // stays inside Netlify's request cap after base64

/**
 * Direct human send from the lead page (no Arnold draft involved).
 * Body: { channel: "sms" | "email", body, subject?, who?,
 *         photo?: { name, type, dataBase64 } } — photo goes out as MMS
 * media / email attachment and lands in the conversation thread.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = requireSession(req);
  if (guard) return guard;
  try {
    const { id } = await ctx.params;
    const found = await getLead(id);
    if (!found) return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    const { lead, shape } = found;

    const input = (await req.json()) as {
      channel: "sms" | "email";
      body?: string;
      subject?: string;
      who?: string;
      photo?: { name?: string; type?: string; dataBase64?: string };
    };
    const body = (input.body || "").trim();
    const subject = (input.subject || "").trim();
    const who = input.who || "app";
    if (!body) return NextResponse.json({ error: "Message body is empty" }, { status: 400 });

    // Photo: validate, park it in Drive (public link), remember both URLs.
    let photoUrl = "";
    let photoBuffer: Buffer | null = null;
    let photoName = "";
    let photoType = "";
    if (input.photo?.dataBase64) {
      photoType = (input.photo.type || "").toLowerCase();
      if (!photoType.startsWith("image/")) {
        return NextResponse.json({ error: "Only image attachments are supported" }, { status: 400 });
      }
      photoBuffer = Buffer.from(input.photo.dataBase64, "base64");
      if (photoBuffer.length > MAX_PHOTO_BYTES) {
        return NextResponse.json({ error: "Photo too large — keep it under 3.5 MB" }, { status: 400 });
      }
      photoName = input.photo.name || `photo.${photoType.split("/")[1] || "jpg"}`;
      const stored = await saveLeadPhoto(lead.id, photoType, photoBuffer);
      photoUrl = stored.url;
    }

    let deliveryNote: string;
    let trackId = "";
    if (input.channel === "sms") {
      if (!lead.phoneDialable) {
        return NextResponse.json({ error: `No dialable phone number on this lead ("${lead.phone}")` }, { status: 400 });
      }
      const { sid } = await sendSms(lead.phoneDialable, body, photoUrl ? [photoUrl] : []);
      deliveryNote = `${photoUrl ? "MMS (with photo)" : "SMS"} sent to ${lead.phoneDialable} (Twilio ${sid})`;
    } else if (input.channel === "email") {
      if (!lead.emailClean) {
        return NextResponse.json({ error: `No valid email on this lead ("${lead.email}")` }, { status: 400 });
      }
      if (!subject) return NextResponse.json({ error: "Email subject is required" }, { status: 400 });
      trackId = crypto.randomBytes(12).toString("hex");
      const { messageId } = await sendEmail(
        lead.emailClean,
        subject,
        body,
        photoBuffer ? [{ filename: photoName, contentType: photoType, content: photoBuffer }] : [],
        `${config.publicBaseUrl}/api/track/${trackId}.gif`
      );
      deliveryNote = `Email "${subject}"${photoBuffer ? " (with photo)" : ""} sent to ${lead.emailClean} (${messageId})`;
    } else {
      return NextResponse.json({ error: `Unknown channel "${input.channel}"` }, { status: 400 });
    }

    const now = new Date().toISOString();
    await appendTimeline(
      lead,
      shape,
      {
        at: now,
        who,
        kind: input.channel === "sms" ? "sms_out" : "email_out",
        ...(trackId ? { trackId } : {}),
        text:
          (input.channel === "email"
            ? `${deliveryNote} — written by ${who}. Full message:\nSubject: ${subject}\n\n${body}`
            : `${deliveryNote} — written by ${who}. Full message:\n${body}`) +
          (photoUrl ? `\n📷 Photo: ${photoUrl}` : ""),
      },
      { touchLastContact: true }
    );
    return NextResponse.json({ ok: true, detail: deliveryNote });
  } catch (err) {
    return jsonError(err);
  }
}
