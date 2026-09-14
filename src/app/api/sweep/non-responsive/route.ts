import { NextRequest, NextResponse } from "next/server";
import { sweepNonResponsive } from "@/lib/leads";
import { notifyTelegram } from "@/lib/arnold";
import { requireSession, jsonError } from "@/lib/api";
import { config } from "@/lib/config";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Daily Non-Responsive sweep (cron with ?key=, or a signed-in user). ?dry=1 previews. */
export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get("key") !== config.accessKey) {
    const guard = requireSession(req);
    if (guard) return guard;
  }
  try {
    const dry = req.nextUrl.searchParams.get("dry") === "1";
    const moved = await sweepNonResponsive({ dryRun: dry });
    if (!dry && moved.length) {
      notifyTelegram(
        `🔇 <b>${moved.length} of Arnold's lead${moved.length > 1 ? "s" : ""} went Non-Responsive</b> (3+ attempts, no reply, 2+ days quiet):\n` +
          moved.map((m) => `• ${m.name} — ${m.touches} attempts, last ${new Date(m.lastTouch).toLocaleDateString("en-US")}`).join("\n") +
          `\nThey wake to Active on their own if they ever respond.`
      ).catch(() => {});
    }
    return NextResponse.json({ dryRun: dry, count: moved.length, moved });
  } catch (err) {
    return jsonError(err);
  }
}
