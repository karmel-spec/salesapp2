import { NextRequest, NextResponse } from "next/server";
import { requireSession, jsonError } from "@/lib/api";
import { config } from "@/lib/config";
import { createLead, getLeads, appendTimeline } from "@/lib/leads";
import { getPianos, findBySerial, describe } from "@/lib/pianolog";
import { listHandoffs, patchHandoff, handoffStoreReady, logHandoff } from "@/lib/won";

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
    const rows = await listHandoffs(`branch=eq.shop&status=eq.sent&or=(arrived_at.is.null,and(upsell_followup.eq.true,upsell_triggered_at.is.null))&order=created_at.asc`);
    if (!rows.length) return NextResponse.json({ checked: 0, triggered: [], arrived: [] });
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
    return NextResponse.json({ checked: rows.length, triggered, arrived, dry });
  } catch (err) {
    return jsonError(err);
  }
}
