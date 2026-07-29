import { NextRequest, NextResponse } from "next/server";
import { readLeadPhoto } from "@/lib/media";

export const dynamic = "force-dynamic";

/**
 * Serves photo attachments. Deliberately UNAUTHENTICATED: Twilio's MMS
 * fetcher and the customer's email client both hit these URLs with no
 * session — privacy comes from the unguessable 128-bit random key.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ key: string }> }) {
  const { key } = await ctx.params;
  const photo = await readLeadPhoto(key);
  if (!photo) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return new NextResponse(new Uint8Array(photo.data), {
    headers: {
      "Content-Type": photo.mimeType,
      "Cache-Control": "public, max-age=31536000, immutable",
      "Content-Length": String(photo.data.length),
    },
  });
}
