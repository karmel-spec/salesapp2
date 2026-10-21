import { NextRequest, NextResponse } from "next/server";
import { requireSession, jsonError } from "@/lib/api";
import { config } from "@/lib/config";
import { createLead, getLeads, appendTimeline } from "@/lib/leads";
import { getPianos, findBySerial, describe } from "@/lib/pianolog";
import { listHandoffs, patchHandoff, handoffStoreReady, logHandoff, pushShopScope, shopScopeLines, SCOPE_DONE_RE } from "@/lib/won";

const BRIDGE_URL = process.env.BLP_BRIDGE_URL || "https://script.google.com/macros/s/AKfycbxY4BKnr_Tr0iCTc9itCWhNYLvgszmkI1IoYSkbBWpyAqRtWI-yaUkJQjcVdgG58KXt/exec";
const BRIDGE_PIN = process.env.BLP_BRIDGE_PIN || "";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Shop phases in order (shared with the Store Map / Client Portal). 50% complete = Restringing or later, or 7+ phases done. */
const PHASES = ["New Arrival - Admin", "Assessment", "CAP", "PRSB - Downbearing", "PRSB - Notching and Pins", "Lacquer Soundboard", "Restringing", "Chip Tuning", "DHRT", "1st Tuning", "Refinishing", "QC & Assembly", "2nd Tuning", "Exit Prep - Admin", "Delivered"];
const HALF = 7; // index of "Chip Tuning": reaching it means the first half is behind us

/**
 * Daily (with the watch sweep): shop projects whose owner said yes to the 50%
 * upsell call come back into Brigham's BL Leads Top Ten as a fresh lead when
 * the Piano Log shows the piano past the halfway phase. Also marks "piano
 * coming" handoffs as arrived once their serial shows up in the Piano Log.
 */
export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key");
  if (key !== config.accessKey) { const guard = requireSession(req); if (guard) return guard; }
  try {
    if (!handoffStoreReady()) return NextResponse.json({ checked: 0, reason: "store not configured" });
    const dry = req.nextUrl.searchParams.get("dry") === "1";
    const scope = await scopeSweep(dry);
    if (req.nextUrl.searchParams.get("only") === "scope") return NextResponse.json({ scope, dry });
    const rows = await listHandoffs(`branch=eq.shop&status=eq.sent&or=(arrived_at.is.null,and(upsell_followup.eq.true,upsell_triggered_at.is.null))&order=created_at.asc`);
    if (!rows.length) return NextResponse.json({ checked: 0, triggered: [], arrived: [], scope });
    const pianos = await getPianos(true);
    const triggered: string[] = [], arrived: string[] = [];
    for (const r of rows) {
      if (!r.serial) continue;
      const p = findBySerial(r.serial, pianos);
      if (!p || p.sold) continue;
      if (!r.arrived_at) {
        arrived.push(r.lead_name);
        if (!dry) { await patchHandoff(r.id, { arrived_at: new Date().toISOString() }); await logHandoff(r, `Piano arrived — Piano Log row ${p.row} (${p.phase || "no phase"})`); }
      }
      if (!r.upsell_followup || r.upsell_triggered_at) continue;
      const idx = PHASES.findIndex((x) => x.toLowerCase() === (p.phase || "").trim().toLowerCase());
      const done = (p as unknown as { phasesDone?: string }).phasesDone ? String((p as unknown as { phasesDone?: string }).phasesDone).split(/[|,]/).filter((x) => x.trim()).length : 0;
      if (idx < HALF && done < HALF) continue;
      triggered.push(r.lead_name);
      if (dry) continue;
      const h = r.answers;
      const { leads } = await getLeads(true);
      const orig = leads.find((l) => l.id === r.lead_id);
      try {
        const id = await createLead({
          firstName: orig?.firstName || r.lead_name.split(" ")[0], lastName: orig?.lastName || r.lead_name.split(" ").slice(1).join(" "),
          headline: `50% update call + upsell: ${describe(p)}`,
          phone: orig?.phoneDialable || r.client_phone || "", email: orig?.emailClean || r.client_email || "", address: orig?.address || "",
          source: "Repeat customer", inquiryMethod: "Phone Call", leadType: "Restoration", pianoType: r.piano_type || orig?.pianoType || "", value: "",
          score: "8", capturedBy: "app", openedBy: "Brigham",
          notes: `Shop project is past 50% (phase: ${p.phase || "n/a"}). Brigham promised an update call with upsell suggestions${h.items.refinish?.v === "upsell" ? " — refinishing upsell was planned for this point" : ""}.\nOriginal sale: ${r.summary_text || ""}\nOriginal lead: ${config.publicBaseUrl}/leads/${encodeURIComponent(r.lead_id)}`,
          skipDedupe: true,
        });
        await patchHandoff(r.id, { upsell_triggered_at: new Date().toISOString(), upsell_lead_id: id });
        await logHandoff(r, `50% reached (${p.phase}) — new lead ${id} in Brigham's Top Ten`);
        const fresh = await getLeads(true);
        const nl = fresh.leads.find((l) => l.id === id);
        if (nl) await appendTimeline(nl, fresh.shape, { at: new Date().toISOString(), who: "app", kind: "assign", text: `🔔 Shop project hit 50% — time for Brigham's update + upsell call (from WON handoff ${r.id}).` });
      } catch (e) { await logHandoff(r, `50% lead failed: ${e instanceof Error ? e.message : String(e)}`, false); }
    }
    return NextResponse.json({ checked: rows.length, triggered, arrived, scope, dry });
  } catch (err) {
    return jsonError(err);
  }
}

/** 🏆 Shop notes → the piano's Scope of Work (Mark 10/21): every shop handoff
 *  from the last 120 days whose fix requests / piano note aren't on the piano
 *  card yet — the piano had no Piano Log row at send time, or the send-time
 *  write failed. The bridge skips lines already on the card, so a retry is safe. */
async function scopeSweep(dry: boolean) {
  // handoffs before 10/21 were reviewed and written by hand (Mark 10/21 — some
  // of their notes were record-keeping or client money, not shop info), so the
  // sweep only picks up handoffs sent from then on
  const since = new Date(Math.max(Date.now() - 120 * 86400e3, Date.parse("2026-10-21T06:00:00Z"))).toISOString();
  const rows = await listHandoffs(`branch=eq.shop&status=eq.sent&created_at=gte.${since}&order=created_at.asc`);
  const done: string[] = [], waiting: string[] = [], plan: { lead: string; row?: number; adding?: string[] }[] = [];
  for (const r of rows) {
    if ((r.log || []).some((l) => SCOPE_DONE_RE.test(l.text))) continue;
    if (!shopScopeLines(r.answers, r.created_at).lines.length) continue;
    const res = await pushShopScope(r, { url: BRIDGE_URL, pin: BRIDGE_PIN }, dry).catch((e) => ({ ok: false, error: e instanceof Error ? e.message : String(e) } as { ok: boolean; error?: string; row?: number; added?: number; adding?: string[] }));
    if (dry) { plan.push({ lead: r.lead_name, row: res.row, adding: res.adding || (res.error ? [`✗ ${res.error}`] : []) }); continue; }
    if (res.ok) { done.push(r.lead_name); await logHandoff(r, `Shop notes on the piano card — Piano Log row ${res.row}${res.added ? ` (${res.added} line${res.added === 1 ? "" : "s"})` : " (already there)"}`); }
    else waiting.push(`${r.lead_name}: ${res.error}`);
  }
  return dry ? { checked: rows.length, plan } : { checked: rows.length, done, waiting };
}
