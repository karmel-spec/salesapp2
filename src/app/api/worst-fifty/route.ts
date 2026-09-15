import { NextRequest, NextResponse } from "next/server";
import { getLeads } from "@/lib/leads";
import { rankWeakLeads } from "@/lib/worst";
import { workedSince } from "@/lib/topten-auto";
import { dayKey } from "@/lib/streak";
import { requireSession, jsonError } from "@/lib/api";

export const dynamic = "force-dynamic";

/** GET — the 50 weakest open leads not assigned to Brigham, with today's worked flag. */
export async function GET(req: NextRequest) {
  const guard = requireSession(req);
  if (guard) return guard;
  try {
    const { leads } = await getLeads(req.nextUrl.searchParams.get("fresh") === "1");
    const startOfToday = new Date(`${dayKey(new Date())}T06:00:00.000Z`).toISOString();
    const items = rankWeakLeads(leads).map((x) => {
      const l = leads.find((y) => y.id === x.leadId);
      return { ...x, headline: l?.headline || "", status: l?.status || "", worked: l ? workedSince(l, startOfToday) : false };
    });
    return NextResponse.json({ generatedAt: new Date().toISOString(), items });
  } catch (err) {
    return jsonError(err);
  }
}
