import { NextRequest, NextResponse, after } from "next/server";
import { recordEmailOpen } from "@/lib/leads";

export const dynamic = "force-dynamic";

// 1×1 transparent GIF
const PIXEL = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");

/**
 * Email open-tracking pixel. Deliberately UNAUTHENTICATED — the customer's
 * mail client fetches it when the email is displayed. Returns the pixel
 * instantly; the open-stamp write happens after the response is sent.
 * First open wins; later loads are no-ops.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const trackId = token.replace(/\.gif$/i, "");
  if (/^[a-f0-9]{16,64}$/i.test(trackId)) {
    after(async () => {
      try {
        await recordEmailOpen(trackId);
      } catch {
        /* opens are best-effort — never break the pixel */
      }
    });
  }
  return new NextResponse(new Uint8Array(PIXEL), {
    headers: {
      "Content-Type": "image/gif",
      "Content-Length": String(PIXEL.length),
      "Cache-Control": "no-store, no-cache, must-revalidate, private",
    },
  });
}
