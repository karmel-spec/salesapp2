import { NextRequest, NextResponse } from "next/server";
import { runStaffEmailSweep } from "@/lib/email-sweep";
import { requireSession, jsonError } from "@/lib/api";
import { config } from "@/lib/config";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Daily staff-email sweep (cron with ?key=, or a signed-in user). ?dry=1 previews, ?days=N widens the look-back. */
export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get("key") !== config.accessKey) {
    const guard = requireSession(req);
    if (guard) return guard;
  }
  try {
    const q = req.nextUrl.searchParams;
    const r = await runStaffEmailSweep({ dryRun: q.get("dry") === "1", days: Number(q.get("days") || 3) || 3, box: q.get("box") || undefined, offset: Number(q.get("offset") || 0) || 0, chunk: Number(q.get("chunk") || 40) || 40 });
    return NextResponse.json(r);
  } catch (err) {
    return jsonError(err);
  }
}
