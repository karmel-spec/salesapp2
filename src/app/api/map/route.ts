import { NextRequest, NextResponse } from "next/server";
import { getLeads } from "@/lib/leads";
import { extractGeo } from "@/lib/geo";
import { requireSession, jsonError } from "@/lib/api";
import { config } from "@/lib/config";
import type { MapLead } from "@/lib/geo-shared";

export const dynamic = "force-dynamic";

/**
 * Leads with best-effort coordinates for the Map page. Location is mined from
 * the headline first, then the notes (see lib/geo.ts). Leads with no
 * detectable location are returned too (geo: null) so the page can list them.
 */
export async function GET(req: NextRequest) {
  const guard = requireSession(req);
  if (guard) return guard;
  try {
    const force = req.nextUrl.searchParams.get("refresh") === "1";
    const { leads } = await getLeads(force);
    const out: MapLead[] = leads.map((l) => ({
      id: l.id,
      name: l.name,
      headline: l.headline,
      statusBucket: l.statusBucket,
      isStale: l.isStale,
      rep: l.effectiveRep,
      subRep: l.effectiveSubRep,
      score: l.score,
      value: l.value,
      leadType: l.leadType,
      pianoType: l.pianoType,
      daysSinceContact: l.daysSinceContact,
      geo: extractGeo(l.headline, l.notes, l.activityTimeline, l.appActivity),
    }));
    return NextResponse.json({ leads: out, mapsApiKey: config.googleMapsApiKey });
  } catch (err) {
    return jsonError(err);
  }
}
