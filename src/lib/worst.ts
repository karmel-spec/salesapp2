import type { Lead } from "./leads";

/**
 * The "Worst 50": open leads (not Brigham's) least likely to become a sale and
 * most likely to soak up team time — old CRM imports nobody ever touched,
 * silent after attempts, unreachable, or told us "not now". Arnold works them
 * with a quick check-in text, then marks the silent ones Dormant.
 */
export interface WeakItem { rank: number; leadId: string; leadName: string; rep: string; reason: string; touches: number; replies: number; hasPhone: boolean; hasEmail: boolean }

const OUT = new Set(["sms_out", "email_out", "call", "call_attempt"]);
const AUTO = /auto|salescaptain|^app$|^phone$|^twilio$/i;
const NEG = /\b(not interested|no longer (interested|need)|already (bought|purchased|sold|found|have)|went with|found (one|another)|bought (one|another|elsewhere)|stop texting|remove me|unsubscribe|wrong number|do not contact|don'?t contact|not (right )?now|maybe (next|some) ?(year|day)|no thanks|no thank you|not looking|can'?t afford|too (expensive|much)|out of (my|our) (budget|price)|hold off|holding off|pass(ing)? for now|decided (not|against))\b/i;

export function rankWeakLeads(leads: Lead[], opts: { excludeRep?: string; limit?: number } = {}): WeakItem[] {
  const excl = (opts.excludeRep || "Brigham").toLowerCase();
  const now = Date.now();
  const pool = leads.filter((l) => (l.effectiveRep || "").toLowerCase() !== excl && (l.statusBucket === "new" || l.statusBucket === "active") && !l.watch?.active);
  const rows = pool.map((l) => {
    const tl = [...l.timeline].sort((a, b) => a.at.localeCompare(b.at));
    const inb = tl.filter((e) => e.kind === "inbound");
    const outs = tl.filter((e) => OUT.has(e.kind) && !(e.who && AUTO.test(e.who) && !/written by|approved/.test(e.text || "")));
    const human = tl.filter((e) => !["draft", "created", "assign"].includes(e.kind) && !(e.who && AUTO.test(e.who)));
    const lastAny = human.map((e) => e.at).pop();
    const quiet = lastAny ? Math.floor((now - Date.parse(lastAny)) / 86400_000) : null;
    const lastIn = inb.map((e) => e.at).pop();
    const inDays = lastIn ? Math.floor((now - Date.parse(lastIn)) / 86400_000) : null;
    const negTxt = inb.slice(-3).map((e) => (e.text || "").replace(/^📥[^"]*"/, "").replace(/"$/, "")).find((t) => NEG.test(t)) || "";
    const heat = Number(l.score) || 0;
    const reach = !!(l.phoneDialable || l.emailClean);
    const agile = /agile/i.test(l.leadType || "") || /^(try|follow ?up|check|still|ready|it'?s been)/i.test(l.headline || "");
    let bad = 0; const why: string[] = [];
    if (inDays !== null && inDays <= 30) bad -= 60; // they wrote recently — not weak
    if (negTxt) { bad += 45; why.push(`they said "${negTxt.replace(/\s+/g, " ").slice(0, 55)}"`); }
    if (!inb.length && outs.length >= 3) { bad += 40; why.push(`${outs.length} attempts, never replied`); }
    else if (!inb.length && outs.length >= 1) { bad += 22; why.push(`${outs.length} attempt${outs.length > 1 ? "s" : ""}, no reply`); }
    else if (!inb.length && !outs.length) { bad += 12; why.push("never contacted, never replied"); }
    if (inDays !== null && inDays > 90) { bad += 18; why.push(`last heard from them ${inDays}d ago`); }
    else if (inDays !== null && inDays > 45) { bad += 10; why.push(`silent ${inDays}d since last reply`); }
    if (quiet !== null && quiet > 120) { bad += 15; why.push(`no activity in ${quiet}d`); }
    else if (quiet !== null && quiet > 60) { bad += 8; why.push(`no activity in ${quiet}d`); }
    if (!reach) { bad += 30; why.push("no phone or email"); }
    if (heat && heat <= 3) { bad += 12; why.push(`heat ${heat}/10`); }
    if (agile) { bad += 10; why.push("old Agile CRM task, not a live inquiry"); }
    if (!l.value && !l.headline) { bad += 5; why.push("no headline or value"); }
    return { l, bad, why, quiet, outs: outs.length, inb: inb.length };
  });
  rows.sort((a, b) => b.bad - a.bad || (b.quiet ?? 0) - (a.quiet ?? 0));
  return rows.slice(0, opts.limit ?? 50).map((r, i) => ({ rank: i + 1, leadId: r.l.id, leadName: r.l.name, rep: r.l.effectiveRep || "", reason: r.why.join(" · ") || "weak signals all around", touches: r.outs, replies: r.inb, hasPhone: !!r.l.phoneDialable, hasEmail: !!r.l.emailClean }));
}
