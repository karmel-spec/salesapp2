import { NextRequest, NextResponse } from "next/server";
import { getBoard } from "@/lib/board";
import { requireSession, jsonError } from "@/lib/api";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Team Inbox Board data. ?count=1 → just the nav bubble totals. */
export async function GET(req: NextRequest) {
  const guard = requireSession(req);
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
