import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Whisper-leg TwiML: played to the CUSTOMER the moment they answer a
 * bridged call, before joining — the recording-consent announcement.
 * (Utah is one-party consent, but the client may be in a two-party state,
 * so every recorded call announces.)
 */
const XML = `<?xml version="1.0" encoding="UTF-8"?>
<Response><Say voice="alice">This call may be recorded for quality purposes.</Say></Response>`;

const respond = () => new NextResponse(XML, { headers: { "Content-Type": "text/xml" } });

export async function GET() {
  return respond();
}
export async function POST() {
  return respond();
}
