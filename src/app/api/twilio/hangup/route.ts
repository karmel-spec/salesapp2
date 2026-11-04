import { NextRequest, NextResponse } from "next/server";
import { requireSession, jsonError } from "@/lib/api";
import { hangUpCall } from "@/lib/comms";

export const dynamic = "force-dynamic";

/**
 * Hang up from our side. The browser dialer calls this alongside the SDK's
 * disconnect (belt and braces), and the "ring my cell first" mode uses it
 * as its only hang-up control. Ending the parent call makes Twilio drop
 * the customer leg too; the recording callback still fires.
 *
 * POST { callSid } → { ok, status }
 */
export async function POST(req: NextRequest) {
  const guard = requireSession(req);
  if (guard) return guard;
  try {
    const body = (await req.json().catch(() => ({}))) as { callSid?: string };
    const sid = (body.callSid || "").trim();
    if (!/^CA[0-9a-f]{32}$/i.test(sid) && sid !== "DRYRUN-CALL") {
      return NextResponse.json({ error: "callSid required" }, { status: 400 });
    }
    const r = await hangUpCall(sid);
    return NextResponse.json({ ok: true, ...r });
  } catch (err) {
    return jsonError(err);
  }
}
