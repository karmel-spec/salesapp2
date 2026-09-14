import { getLeads, getLead, updateLeadFields, appendTimeline, type Lead, type LeadWatch, type SheetShape } from "./leads";
import { getPianos, matchArrival, findBySerial, describe, type Piano } from "./pianolog";
import { notifyTelegram, notifyArnoldWebhook } from "./arnold";

export const watchStatus = (w: LeadWatch) => `Snoozed until 🎹 ${w.mode === "finished" && w.serial ? `#${w.serial} is finished` : w.text}`.slice(0, 120);

/** Current Piano Log matches for a watch (what we could tell the customer today). */
export async function previewWatch(w: Pick<LeadWatch, "text" | "serial" | "mode">): Promise<{ matches: Piano[]; serialPiano?: Piano }> {
  const pianos = await getPianos();
  const serialPiano = w.serial ? findBySerial(w.serial, pianos) : undefined;
  const matches = w.mode === "finished" ? (serialPiano ? [serialPiano] : []) : matchArrival({ ...w, createdAt: "", createdBy: "", seenSerials: [], active: true }, pianos);
  return { matches, serialPiano };
}

/** Put a lead to sleep until the Piano Log shows what they want. */
export async function setWatch(lead: Lead, shape: SheetShape, input: { text: string; serial?: string; mode: "arrival" | "finished"; who: string; baseline?: boolean }) {
  const { matches } = await previewWatch(input);
  const w: LeadWatch = {
    text: input.text.trim(),
    serial: (input.serial || "").trim() || undefined,
    mode: input.mode,
    createdAt: new Date().toISOString(),
    createdBy: input.who,
    // baseline: pianos already in stock at snooze time were offered now — only NEW ones wake the lead
    seenSerials: input.baseline && input.mode === "arrival" ? matches.map((p) => p.serial || `row${p.row}`) : [],
    active: true,
  };
  await updateLeadFields(lead, shape, { status: watchStatus(w), watchJson: JSON.stringify(w) });
  await appendTimeline(lead, shape, {
    at: w.createdAt,
    who: input.who,
    kind: "note",
    text: `💤🎹 Watching the Piano Log — ${w.mode === "finished" ? `wake when #${w.serial} is finished / for sale` : `wake when a piano matching "${w.text}" comes in`}${input.baseline && matches.length ? ` (${matches.length} already in stock today, offered now)` : ""}.`,
  });
  return { watch: w, matches };
}

export async function clearWatch(lead: Lead, shape: SheetShape, who: string, newStatus = "Active") {
  const w = lead.watch ? { ...lead.watch, active: false } : null;
  await updateLeadFields(lead, shape, { status: newStatus, watchJson: w ? JSON.stringify(w) : "" });
  await appendTimeline(lead, shape, { at: new Date().toISOString(), who, kind: "note", text: "🎹 Watch snooze cleared — lead is active again." });
}

export interface SweepResult { checked: number; woke: { leadId: string; leadName: string; why: string }[]; dryRun: boolean; pianos: number }

/**
 * Daily sweep: for every lead with an active watch, look at the Piano Log.
 * Arrival watches wake on a matching not-sold piano we haven't alerted on;
 * serial watches wake when that piano is finished/for sale — or sold to
 * someone else (so the rep can offer alternatives).
 */
export async function runWatchSweep(opts: { dryRun?: boolean } = {}): Promise<SweepResult> {
  const pianos = await getPianos(true);
  const { leads, shape } = await getLeads(true);
  const targets = leads.filter((l) => l.watch?.active);
  const out: SweepResult = { checked: targets.length, woke: [], dryRun: !!opts.dryRun, pianos: pianos.length };
  for (const l of targets) {
    const w = l.watch!;
    let hits: Piano[] = [];
    let why = "";
    if (w.mode === "finished" && w.serial) {
      const p = findBySerial(w.serial, pianos);
      if (p?.sold) { hits = [p]; why = `⚠️ the piano they were waiting for, #${w.serial}, is marked SOLD — offer alternatives`; }
      else if (p?.finished) { hits = [p]; why = `🔔 #${w.serial} is finished: ${describe(p)}`; }
    } else {
      const seen = new Set(w.seenSerials || []);
      hits = matchArrival(w, pianos).filter((p) => !seen.has(p.serial || `row${p.row}`));
      if (hits.length) why = `🔔 ${hits.length} piano${hits.length > 1 ? "s" : ""} matching "${w.text}":\n• ${hits.slice(0, 5).map(describe).join("\n• ")}${hits.length > 5 ? `\n… +${hits.length - 5} more` : ""}`;
    }
    if (!hits.length) continue;
    out.woke.push({ leadId: l.id, leadName: l.name, why });
    if (opts.dryRun) continue;
    const fresh = (await getLead(l.id, true))?.lead || l;
    const updated: LeadWatch = { ...w, active: false, matchedAt: new Date().toISOString(), matchedSummary: why.slice(0, 500), seenSerials: [...(w.seenSerials || []), ...hits.map((p) => p.serial || `row${p.row}`)] };
    await updateLeadFields(fresh, shape, { status: "Active (🎹 watch matched)", watchJson: JSON.stringify(updated) });
    await appendTimeline(fresh, shape, { at: new Date().toISOString(), who: "app", kind: "assign", text: `${why}\n\nThe customer asked to be contacted when this happened — the lead is active again.` });
    notifyTelegram(`🎹 <b>${l.name}</b> was waiting for this — ${why.split("\n")[0]}\nLead is active again: ${(process.env.PUBLIC_BASE_URL || "https://blpsalesapp.netlify.app")}/leads/${encodeURIComponent(l.id)}`).catch(() => {});
    notifyArnoldWebhook({ event: "watch_matched", lead: { id: l.id }, note: `${l.name} asked to be contacted when this became available. ${why}. Draft a short "it's here / it's finished" text or email for approval.` }).catch(() => {});
  }
  return out;
}
