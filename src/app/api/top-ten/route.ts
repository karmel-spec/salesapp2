import { NextRequest, NextResponse } from "next/server";
import { getLeads } from "@/lib/leads";
import { getTopTen, getSeen, saveTopTen, topTenScope, type TopTenItem } from "@/lib/topten";
import { rankLeads, workedSince } from "@/lib/topten-auto";
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
    const scope = topTenScope(req.nextUrl.searchParams.get("scope"));
    const rep = scope === "arnold" ? "Arnold" : "Brigham";
    const next = req.nextUrl.searchParams.get("next") === "1";
    const { leads } = await getLeads(true);
    let list = await getTopTen(scope);
    let auto = false;
    if (next) {
      // "Next ten": everything offered today so far is set aside; rank the rest.
      const seen = await getSeen(scope);
      for (const x of list?.items || []) seen.add(x.leadId);
      const items = rankLeads(leads, rep, seen);
      if (!items.length) return NextResponse.json({ savedAt: list?.savedAt || null, scope, exhausted: true, items: [] });
      await saveTopTen(items, "next-ten", scope, { addSeen: (list?.items || []).map((x) => x.leadId) });
      list = { savedAt: new Date().toISOString(), savedBy: "next-ten", items };
      auto = true;
    } else if (scope === "arnold" && (!list || Date.now() - Date.parse(list.savedAt) > 36 * 3600_000)) {
      // Arnold's own list is ranked live until (or unless) he posts picks with
      // scope "arnold" — then his picks win for the day.
      list = { savedAt: new Date().toISOString(), savedBy: "auto-ranked", items: rankLeads(leads, "Arnold") };
      auto = true;
    }
    if (!list) return NextResponse.json({ savedAt: null, scope, items: [] });
    const savedAt = list.savedAt;
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
        worked: l ? workedSince(l, savedAt) : true,
      };
    });
    return NextResponse.json({ savedAt: list.savedAt, savedBy: list.savedBy, scope, auto, items });
  } catch (err) {
    return jsonError(err);
  }
}

export async function POST(req: NextRequest) {
  const guard = requireSession(req);
  if (guard && !isValidArnoldKey(req.headers.get("x-blp-key"))) return guard;
  try {
    const input = (await req.json()) as { items?: TopTenItem[]; who?: string; scope?: string };
    const items = (input.items || []).filter((x) => x.leadId);
    if (!items.length) return NextResponse.json({ error: "items[] with leadId required" }, { status: 400 });
    const scope = topTenScope(input.scope || req.nextUrl.searchParams.get("scope"));
    // A fresh morning list starts the day over: earlier "seen" markers go away.
    await saveTopTen(items, input.who || "Arnold", scope, { clearSeen: true });
    return NextResponse.json({ ok: true, scope, count: Math.min(items.length, 10) });
  } catch (err) {
    return jsonError(err);
  }
}
