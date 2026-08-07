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
const ALLOWED_ATTACH =
  /^(image\/|application\/pdf$|text\/(plain|csv)$|audio\/|video\/mp4$|application\/(msword|vnd\.openxmlformats-officedocument\.(wordprocessingml\.document|spreadsheetml\.sheet)|vnd\.ms-excel)$)/;

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
      sendAs?: string; // email identity: "" = info@, rep name = their mailbox
      photo?: { name?: string; type?: string; dataBase64?: string };
    };
    const body = (input.body || "").trim();
    const subject = (input.subject || "").trim();
    const who = input.who || "app";
    if (!body) return NextResponse.json({ error: "Message body is empty" }, { status: 400 });

    // Attachment (photo or file): validate, park in blob storage, keep the URL.
    let photoUrl = "";
    let photoBuffer: Buffer | null = null;
    let photoName = "";
    let photoType = "";
    let isImage = false;
    if (input.photo?.dataBase64) {
      photoType = (input.photo.type || "").toLowerCase();
      if (!ALLOWED_ATTACH.test(photoType)) {
        return NextResponse.json(
          { error: "Unsupported attachment type — photos, PDFs, docs, audio, or video" },
          { status: 400 }
        );
      }
      isImage = photoType.startsWith("image/");
      photoBuffer = Buffer.from(input.photo.dataBase64, "base64");
      if (photoBuffer.length > MAX_PHOTO_BYTES) {
        return NextResponse.json({ error: "Attachment too large — keep it under 3.5 MB" }, { status: 400 });
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
      // Images ride as MMS media; other files go as a link (carriers reject
      // most non-image MMS types).
      const smsBody = photoUrl && !isImage ? `${body}\n📎 ${photoName}: ${photoUrl}` : body;
      const { sid } = await sendSms(lead.phoneDialable, smsBody, photoUrl && isImage ? [photoUrl] : []);
      deliveryNote = `${photoUrl ? (isImage ? "MMS (with photo)" : "SMS (with file link)") : "SMS"} sent to ${lead.phoneDialable} (Twilio ${sid})`;
    } else if (input.channel === "email") {
      if (!lead.emailClean) {
        return NextResponse.json({ error: `No valid email on this lead ("${lead.email}")` }, { status: 400 });
      }
      if (!subject) return NextResponse.json({ error: "Email subject is required" }, { status: 400 });
      trackId = crypto.randomBytes(12).toString("hex");
      const identity = input.sendAs !== undefined ? input.sendAs : who;
      const { messageId } = await sendEmail(
        lead.emailClean,
        subject,
        body,
        photoBuffer ? [{ filename: photoName, contentType: photoType, content: photoBuffer }] : [],
        `${config.publicBaseUrl}/api/track/${trackId}.gif`,
        identity
      );
      deliveryNote = `Email "${subject}"${photoBuffer ? (isImage ? " (with photo)" : ` (with "${photoName}")`) : ""} sent to ${lead.emailClean} (${messageId})`;
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
          (photoUrl ? (isImage ? `\n📷 Photo: ${photoUrl}` : `\n📎 File: ${photoUrl} (${photoName})`) : ""),
      },
      { touchLastContact: true }
    );
    return NextResponse.json({ ok: true, detail: deliveryNote });
  } catch (err) {
    return jsonError(err);
  }
}
