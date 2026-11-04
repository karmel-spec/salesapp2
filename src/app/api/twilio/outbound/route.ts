import { NextRequest, NextResponse, after } from "next/server";
import { getLead, appendTimeline } from "@/lib/leads";
import { validTwilioSignature, outboundDialTwiml, toE164 } from "@/lib/twilio-voice";
import { config } from "@/lib/config";

export const dynamic = "force-dynamic";

/**
 * TwiML App Voice URL for browser-placed calls. The Voice SDK's
 * device.connect({ params }) posts To / LeadId / Who here (plus Twilio's
 * own CallSid, From = client:<identity>). We answer with <Dial> to the
 * customer — store caller ID, consent whisper, dual-channel recording whose
 * completion callback files the call onto the lead — and log the attempt.
 *
 * Twilio Console → Voice → TwiML Apps → <app> → Voice Request URL:
 *   POST <PUBLIC_BASE_URL>/api/twilio/outbound
 */
export async function POST(req: NextRequest) {
  const raw = await req.text();
  const params = new URLSearchParams(raw);
  if (!validTwilioSignature(`${config.publicBaseUrl}/api/twilio/outbound`, params, req.headers.get("x-twilio-signature"))) {
    return NextResponse.json({ error: "Invalid Twilio signature" }, { status: 403 });
  }
  const to = toE164(params.get("To") || "");
  const leadId = params.get("LeadId") || "";
  const who = params.get("Who") || "app";
  const callSid = params.get("CallSid") || "";
  const xml = (body: string) => new NextResponse(body, { headers: { "Content-Type": "text/xml" } });

  if (!to) {
    return xml(`<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="alice">That number doesn't look like a 10-digit US or Canadian phone number.</Say><Hangup/></Response>`);
  }

  if (leadId) {
    after(async () => {
      try {
        const found = await getLead(leadId);
        if (!found) return;
        const known = found.lead.phones.find((p) => p.dialable === to);
        await appendTimeline(found.lead, found.shape, {
          at: new Date().toISOString(),
          who,
          kind: "call_attempt",
          text: `Dialed ${known ? `${known.label ? `${known.label} ` : ""}${known.number}` : to} from the Sales App (caller ID ${config.twilioCallerId}, Twilio ${callSid}). Recording + transcript file here when the call ends.`,
        });
      } catch (e) {
        console.error("outbound call log:", e);
      }
    });
  }
  return xml(outboundDialTwiml(to, leadId));
}
