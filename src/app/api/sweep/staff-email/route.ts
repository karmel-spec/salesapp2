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
    const r = await runStaffEmailSweep({ dryRun: req.nextUrl.searchParams.get("dry") === "1", days: Number(req.nextUrl.searchParams.get("days") || 3) || 3 });
    return NextResponse.json(r);
  } catch (err) {
    return jsonError(err);
  }
}
