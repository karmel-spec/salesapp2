import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { config } from "@/lib/config";

export const dynamic = "force-dynamic";

/**
 * Inbound voice webhook for the Twilio number: greet, announce recording,
 * then forward to the store line — recording both sides. When the call
 * ends, /api/twilio/recording archives + transcribes + files it.
 * Forward target: TWILIO_FORWARD_NUMBER env, else the store's public line.
 */

function validSignature(url: string, params: URLSearchParams, signature: string | null): boolean {
  if (!config.twilioAuthToken) return true;
  if (!signature) return false;
  const data =
    url +
    [...params.keys()]
      .sort()
      .map((k) => k + params.get(k))
      .join("");
  const expected = crypto.createHmac("sha1", config.twilioAuthToken).update(data).digest("base64");
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  const raw = await req.text();
  const params = new URLSearchParams(raw);
  if (!validSignature(`${config.publicBaseUrl}/api/twilio/voice`, params, req.headers.get("x-twilio-signature"))) {
    return NextResponse.json({ error: "Invalid Twilio signature" }, { status: 403 });
  }
  const forward = (process.env.TWILIO_FORWARD_NUMBER || config.twilioCallerId).replace(/[^\d+]/g, "");
  const cb = `${config.publicBaseUrl}/api/twilio/recording?direction=inbound`;
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">Thank you for calling Brigham Larson Pianos. This call may be recorded for quality purposes.</Say>
  <Dial callerId="${config.twilioFrom}" timeout="30" record="record-from-answer-dual" recordingStatusCallback="${cb}" recordingStatusCallbackEvent="completed">
    <Number>${forward}</Number>
  </Dial>
</Response>`;
  return new NextResponse(xml, { headers: { "Content-Type": "text/xml" } });
}
