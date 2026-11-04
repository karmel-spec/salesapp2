import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { getBoard } from "@/lib/board";
import { requireSession, jsonError } from "@/lib/api";
import { CRM_KEY } from "@/lib/crm";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** The CRM reads this board server-to-server with the shared BLP_INTEGRATION_KEY
 *  (x-blp-key), the same key every other BLP app-to-app call uses (Brigham 11/4:
 *  the Inbox Board also lives in the CRM's sidebar). */
function integrationKeyOk(req: NextRequest): boolean {
  const got = Buffer.from(req.headers.get("x-blp-key") || "");
  const want = Buffer.from(CRM_KEY);
  return got.length > 0 && got.length === want.length && crypto.timingSafeEqual(got, want);
}

/** Team Inbox Board data. ?count=1 → just the nav bubble totals. */
export async function GET(req: NextRequest) {
  const guard = integrationKeyOk(req) ? null : requireSession(req);
  if (guard) return guard;
  try {
    const board = await getBoard(req.nextUrl.searchParams.get("refresh") === "1");
    if (req.nextUrl.searchParams.get("count") === "1") {
      return NextResponse.json(board.totals);
    }
    return NextResponse.json(board);
  } catch (err) {
    return jsonError(err);
  }
}
