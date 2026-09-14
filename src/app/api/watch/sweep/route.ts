import { NextRequest, NextResponse } from "next/server";
import { runWatchSweep } from "@/lib/watch";
import { requireSession, jsonError } from "@/lib/api";
import { config } from "@/lib/config";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Daily watch sweep (Netlify cron calls with ?key=; a signed-in user may run it too). ?dry=1 previews. */
export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key");
  if (key !== config.accessKey) {
    const guard = requireSession(req);
    if (guard) return guard;
  }
  try {
    const r = await runWatchSweep({ dryRun: req.nextUrl.searchParams.get("dry") === "1" });
    return NextResponse.json(r);
  } catch (err) {
    return jsonError(err);
  }
}
