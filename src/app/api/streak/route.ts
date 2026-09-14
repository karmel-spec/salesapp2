import { NextRequest, NextResponse } from "next/server";
import { getLeads } from "@/lib/leads";
import { computeStreak } from "@/lib/streak";
import { requireSession, jsonError } from "@/lib/api";

export const dynamic = "force-dynamic";

/** GET /api/streak?who=Brigham — today's worked-lead count, business-day streak, best day. */
export async function GET(req: NextRequest) {
  const guard = requireSession(req);
  if (guard) return guard;
  try {
    const who = (req.nextUrl.searchParams.get("who") || "Brigham").trim();
    const { leads } = await getLeads(req.nextUrl.searchParams.get("fresh") === "1");
    return NextResponse.json(computeStreak(leads, who));
  } catch (err) {
    return jsonError(err);
  }
}
