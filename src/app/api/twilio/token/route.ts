import { NextRequest, NextResponse } from "next/server";
import { requireSession, jsonError } from "@/lib/api";
import { voiceConfigured, voiceAccessToken, voiceIdentity } from "@/lib/twilio-voice";
import { config } from "@/lib/config";

export const dynamic = "force-dynamic";

/**
 * Browser dialer: a short-lived Twilio Voice access token for the signed-in
 * rep. The Voice SDK registers with it and places calls through the TwiML
 * App, which hits /api/twilio/outbound to dial the customer.
 *
 * GET ?who=Brigham → { configured, token?, identity?, expiresAt?, callerId }
 */
export async function GET(req: NextRequest) {
  const guard = requireSession(req);
  if (guard) return guard;
  try {
    const who = req.nextUrl.searchParams.get("who") || "rep";
    if (!voiceConfigured()) {
      return NextResponse.json({
        configured: false,
        callerId: config.twilioCallerId,
        reason: "Browser calling isn't set up yet — add TWILIO_API_KEY_SID, TWILIO_API_KEY_SECRET and TWILIO_TWIML_APP_SID (see Settings).",
      });
    }
    const identity = voiceIdentity(who);
    const { token, expiresAt } = voiceAccessToken(identity);
    return NextResponse.json({ configured: true, token, identity, expiresAt, callerId: config.twilioCallerId });
  } catch (err) {
    return jsonError(err);
  }
}
