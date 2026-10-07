/**
 * CRM-first contact data (Brigham, 2026-10-07). The BLP CRM
 * (brighamlarsonpianos.org, repo karmel-spec/blpcrm) is the master for every
 * person: name, phones, emails, address, notes, tags. The sales app pushes
 * every contact it creates or edits there, and every human note. Failures
 * never block the sales app — they're logged and retried on the next touch.
 */
import type { Lead } from "./leads";

const CRM = process.env.CRM_URL || "https://brighamlarsonpianos.org";
const KEY = process.env.BLP_INTEGRATION_KEY || process.env.BLP_APP_ACCESS_KEY || "";

/** Lead type → CRM tag (category "Lead"). */
export function crmTagFor(leadType: string): string | null {
  const t = (leadType || "").toLowerCase();
  if (!t) return null;
  if (/moving|move/.test(t)) return "Piano Move";
  if (/tun/.test(t)) return "Tuning";
  if (/player/.test(t)) return "Player Restoration Lead";
  if (/restor|refinish|refurb|rebuild/.test(t)) return "Restoration Lead";
  if (/rental|event/.test(t)) return "Event Rental";
  if (/qrs/.test(t)) return "QRS Lead";
  if (/trade/.test(t)) return "Trade-in Lead";
  if (/sales/.test(t)) return "Sales Lead";
  return leadType.trim();
}

async function call(path: string, init: RequestInit): Promise<Response | null> {
  if (!KEY) return null;
  try {
    return await fetch(`${CRM}${path}`, { ...init, headers: { "content-type": "application/json", "x-blp-key": KEY, ...(init.headers || {}) }, signal: AbortSignal.timeout(8000) });
  } catch (e) {
    console.warn(`[crm] ${path} unreachable: ${String(e).slice(0, 80)}`);
    return null;
  }
}

/** Find-or-create the CRM client for a lead (additive: appends new phones/emails, fills blank address). Returns the CRM id. */
export async function crmUpsertLead(lead: Pick<Lead, "id" | "name" | "firstName" | "lastName" | "email" | "emailClean" | "phone" | "phoneDialable" | "address" | "leadType" | "source">): Promise<number | null> {
  const name = (lead.name || "").replace("(no name)", "").trim();
  const email = (lead.emailClean || lead.email || "").trim();
  const phone = (lead.phoneDialable || lead.phone || "").trim();
  if (!name && !email && !phone) return null;
  const tag = crmTagFor(lead.leadType);
  const r = await call("/api/clients/resolve", {
    method: "POST",
    body: JSON.stringify({ blp_id: lead.id, name, first: lead.firstName || undefined, last: lead.lastName || undefined, email: email || undefined, phone: phone || undefined, address: lead.address || undefined, source: "Sales App", tag: tag || undefined, tag_category: "Lead" }),
  });
  if (!r) return null;
  if (!r.ok) { console.warn(`[crm] resolve ${r.status} for ${lead.id}`); return null; }
  const j = (await r.json().catch(() => null)) as { id?: number } | null;
  return j?.id ? Number(j.id) : null;
}

/** A human note from the sales app → CRM timeline event (idempotent on ext_id). */
export async function crmNote(clientId: number, note: { at: string; who: string; text: string; leadId: string; type?: string }): Promise<boolean> {
  const r = await call("/api/clients/events", {
    method: "POST",
    body: JSON.stringify({ client_id: clientId, events: [{ ext_id: `salesapp:${note.leadId}:${note.at}`, date: note.at.slice(0, 10), type: note.type || "note", title: `${note.who}: ${note.text.replace(/\s+/g, " ").slice(0, 120)}`, detail: note.text.slice(0, 4000), source: "Sales App" }] }),
  });
  return !!r && r.ok;
}
