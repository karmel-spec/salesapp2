import { NextRequest, NextResponse } from "next/server";
import { getLeads } from "@/lib/leads";
import { getTopTen, saveTopTen, type TopTenItem } from "@/lib/topten";
import { requireSession, jsonError } from "@/lib/api";
import { isValidArnoldKey } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Arnold's daily Top Ten. GET → the saved list joined with live lead facts.
 *  POST { items: [{rank, leadId, leadName?, reason}], who? } — the morning
 *  brief saves the day's picks (Arnold's key or a session). */
export async function GET(req: NextRequest) {
  const guard = requireSession(req);
  if (guard && !isValidArnoldKey(req.headers.get("x-blp-key"))) return guard;
  try {
    const list = await getTopTen();
    if (!list) return NextResponse.json({ savedAt: null, items: [] });
    const { leads } = await getLeads(true);
    const items = list.items.map((x) => {
      const l = leads.find((ld) => ld.id === x.leadId);
      return {
        ...x,
        leadName: l?.name || x.leadName,
        headline: l?.headline || "",
        leadType: l?.leadType || "",
        pianoType: l?.pianoType || "",
        heat: l?.score || "",
        value: l?.value || "",
        daysQuiet: l?.daysSinceContact ?? null,
        rep: l?.effectiveRep || "",
        status: l?.status || "",
        statusBucket: l?.statusBucket || "",
        pendingDrafts: l ? l.drafts.filter((d) => d.status === "pending").length : 0,
        hasPhone: Boolean(l?.phoneDialable),
        hasEmail: Boolean(l?.emailClean),
        gone: !l,
      };
    });
    return NextResponse.json({ savedAt: list.savedAt, savedBy: list.savedBy, items });
  } catch (err) {
    return jsonError(err);
  }
}

export async function POST(req: NextRequest) {
  const guard = requireSession(req);
  if (guard && !isValidArnoldKey(req.headers.get("x-blp-key"))) return guard;
  try {
    const input = (await req.json()) as { items?: TopTenItem[]; who?: string };
    const items = (input.items || []).filter((x) => x.leadId);
    if (!items.length) return NextResponse.json({ error: "items[] with leadId required" }, { status: 400 });
    await saveTopTen(items, input.who || "Arnold");
    return NextResponse.json({ ok: true, count: Math.min(items.length, 10) });
  } catch (err) {
    return jsonError(err);
  }
}
