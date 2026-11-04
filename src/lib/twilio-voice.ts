import crypto from "crypto";
import { config } from "./config";

/**
 * Browser dialer plumbing (Brigham 11/4): the Sales App places calls itself
 * over WebRTC via the Twilio Voice JS SDK, so a rep can dial any number —
 * the lead's, a spouse's, an assistant's — straight from the lead page
 * without a cell phone or a Plaud. Every call shows the store's caller ID,
 * is recorded, and lands in /api/twilio/recording for transcript + summary
 * + filing onto the lead's conversation, same as a bridge call.
 */

export function voiceConfigured(): boolean {
  return Boolean(config.twilioAccountSid && config.twilioApiKeySid && config.twilioApiKeySecret && config.twilioTwimlAppSid);
}

const b64url = (input: Buffer | string) =>
  Buffer.from(input).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");

/** A Twilio Access Token with a Voice grant (outgoing only), HS256-signed with
 *  the API key secret — the exact shape the `twilio` npm helper produces, done
 *  by hand so the app stays dependency-light. */
export function voiceAccessToken(identity: string, ttlSec = 3600): { token: string; expiresAt: string } {
  if (!voiceConfigured()) throw new Error("Browser calling not configured: set TWILIO_API_KEY_SID, TWILIO_API_KEY_SECRET, TWILIO_TWIML_APP_SID");
  const now = Math.floor(Date.now() / 1000);
  const header = { typ: "JWT", alg: "HS256", cty: "twilio-fpa;v=1" };
  const payload = {
    jti: `${config.twilioApiKeySid}-${now}`,
    iss: config.twilioApiKeySid,
    sub: config.twilioAccountSid,
    iat: now,
    exp: now + ttlSec,
    grants: {
      identity,
      voice: { outgoing: { application_sid: config.twilioTwimlAppSid }, incoming: { allow: false } },
    },
  };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const sig = crypto.createHmac("sha256", config.twilioApiKeySecret).update(signingInput).digest();
  return { token: `${signingInput}.${b64url(sig)}`, expiresAt: new Date((now + ttlSec) * 1000).toISOString() };
}

/** A rep name → a Twilio client identity (letters/digits/_ only). */
export function voiceIdentity(who: string): string {
  const slug = (who || "rep").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return `salesapp_${slug || "rep"}`;
}

/** 10/11-digit North American input → +1XXXXXXXXXX, else "". */
export function toE164(raw: string): string {
  const digits = (raw || "").replace(/\D+/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return "";
}

/** Twilio webhook signature check (X-Twilio-Signature over url + sorted params). */
export function validTwilioSignature(url: string, params: URLSearchParams, signature: string | null): boolean {
  if (!config.twilioAuthToken) return true; // unconfigured dev fallback
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

const escXml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** TwiML that dials `to` from the browser leg: store caller ID, consent
 *  whisper to the customer, dual-channel recording filed to the lead. */
export function outboundDialTwiml(to: string, leadId: string): string {
  const cb = `${config.publicBaseUrl}/api/twilio/recording?direction=outbound${leadId ? `&leadId=${encodeURIComponent(leadId)}` : ""}`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial callerId="${escXml(config.twilioCallerId)}" timeout="30" answerOnBridge="true" record="record-from-answer-dual" recordingStatusCallback="${escXml(cb)}" recordingStatusCallbackEvent="completed">
    <Number url="${escXml(config.publicBaseUrl)}/api/twilio/consent">${escXml(to)}</Number>
  </Dial>
</Response>`;
}
