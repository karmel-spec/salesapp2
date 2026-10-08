import { NextRequest, NextResponse } from "next/server";
import { getLead, updateLeadFields, appendTimeline, COLS } from "@/lib/leads";
import { extractGeo } from "@/lib/geo";
import { requireSession, jsonError } from "@/lib/api";
import { isValidArnoldKey } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  // Arnold's draft-only key grants read access (he re-reads leads pre-draft).
  const guard = requireSession(req);
  if (guard && !isValidArnoldKey(req.headers.get("x-blp-key"))) return guard;
  try {
    const { id } = await ctx.params;
    // ?refresh=1 bypasses the in-memory cache — production runs several
    // server instances, and a read after a write must not trust another
    // instance's stale cache (edits looked like they "didn't save").
    const force = req.nextUrl.searchParams.get("refresh") === "1";
    const found = await getLead(id, force);
    if (!found) return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    const l = found.lead;
    return NextResponse.json({
      lead: l,
      // Best-known location (Summary Bar + map) — same miner the map uses.
      geo: extractGeo(l.address, l.headline, l.notes, l.activityTimeline, l.appActivity),
    });
  } catch (err) {
    return jsonError(err);
  }
}

const EDITABLE: (keyof typeof COLS)[] = [
  "status", "rep", "subRep", "openedBy", "closedBy", "headline", "score", "firstName", "lastName", "notes",
  "phone", "email", "social", "address", "source", "inquiryMethod", "leadType",
  "pianoType", "value", "lastContact",
];

const isShopWork = (t: string) => /restoration|refinish|refurbish|qrs|player/i.test(t || "");

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = requireSession(req);
  if (guard) return guard;
  try {
    const { id } = await ctx.params;
    const found = await getLead(id);
    if (!found) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

    const body = (await req.json()) as { fields?: Record<string, string>; who?: string };
    const fields: Partial<Record<keyof typeof COLS, string>> = {};
    for (const [k, v] of Object.entries(body.fields || {})) {
      if (EDITABLE.includes(k as keyof typeof COLS)) fields[k as keyof typeof COLS] = v;
    }
    if (!Object.keys(fields).length) {
      return NextResponse.json({ error: "No editable fields provided" }, { status: 400 });
    }
    await updateLeadFields(found.lead, found.shape, fields, { who: body.who || "Sales App" });
    await appendTimeline(found.lead, found.shape, {
      at: new Date().toISOString(),
      who: body.who || "app",
      kind: "edit",
      text: `Updated ${Object.keys(fields).join(", ")}`,
    });
    // Shop-work lead marked WON → open its Client Portal project (fire and forget; the portal drafts the welcome for approval).
    if (fields.status && /^won/i.test(fields.status) && found.lead.statusBucket !== "won" && isShopWork(found.lead.leadType)) {
      const l = found.lead;
      const portal = process.env.CLIENT_PORTAL_URL || "https://blpclientportal.netlify.app";
      fetch(`${portal}/api/projects/from-sale`, { method: "POST", headers: { "content-type": "application/json", "x-blp-key": process.env.BLP_INTEGRATION_KEY || process.env.BLP_APP_ACCESS_KEY || "pianoman" }, body: JSON.stringify({ lead: { id: l.id, name: l.name, first: l.firstName, last: l.lastName, email: l.emailClean || l.email, phone: l.phoneDialable || l.phone, address: l.address, leadType: l.leadType, pianoType: l.pianoType, value: l.value, rep: fields.closedBy || body.who || l.closedBy, headline: l.headline, notes: l.notes } }) })
        .then(async (r) => { const j = (await r.json().catch(() => ({}))) as { project?: string; url?: string; existing?: boolean; error?: string }; await appendTimeline(found.lead, found.shape, { at: new Date().toISOString(), who: "Client Portal", kind: "edit", text: r.ok ? `${j.existing ? "Client Portal project already open" : "Client Portal project created"}${j.url ? ` — ${j.url}` : ""}` : `Client Portal handoff failed: ${j.error || r.status}` }); })
        .catch(() => {});
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return jsonError(err);
  }
}
