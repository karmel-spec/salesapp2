/**
 * CRM-first contact data (Brigham, 2026-10-07). The BLP CRM
 * (brighamlarsonpianos.org, repo karmel-spec/blpcrm) is the master for every
 * person: name, phones, emails, address, notes, tags. The sales app pushes
 * every contact it creates or edits there, and every human note. Failures
 * never block the sales app — they're logged and retried on the next touch.
 */
import type { Lead } from "./leads";

export const CRM_URL = process.env.CRM_URL || "https://brighamlarsonpianos.org";
export const CRM_KEY = process.env.BLP_INTEGRATION_KEY || process.env.BLP_APP_ACCESS_KEY || "pianoman";
const CRM = CRM_URL;
const KEY = CRM_KEY;

import type { CrmCard } from "./crm-shared";
export { crmFullAddress, type CrmCard } from "./crm-shared";

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

/**
 * A human edited contact fields on a lead. If the lead is linked to a CRM
 * client this is a CORRECTION — it lands on the master via /api/clients/contact
 * (replace-one semantics: the changed value replaces its predecessor inside
 * the CRM's list; other values the CRM knows are kept). The CRM then fans the
 * new card out to every mirror, including our own sheet. An unlinked lead
 * falls back to the additive find-or-create.
 */
export async function crmCorrectContact(
  prev: Pick<Lead, "id" | "name" | "email" | "phone" | "address">,
  merged: Pick<Lead, "id" | "name" | "firstName" | "lastName" | "email" | "emailClean" | "phone" | "phoneDialable" | "address" | "leadType" | "source">,
  who: string
): Promise<number | null> {
  const q = merged.id && !merged.id.startsWith("row-") ? `blp_id=${encodeURIComponent(merged.id)}` : "";
  const found = q ? await call(`/api/clients/resolve?${q}`, { method: "GET" }) : null;
  if (!found || !found.ok) return crmUpsertLead(merged as Lead); // not linked yet → additive create/match
  const { id, client: c } = (await found.json()) as { id: number; client: CrmCard };

  const d10 = (s: string | null | undefined) => String(s || "").replace(/\D/g, "").slice(-10);
  const emailsIn = (s: string): string[] => String(s || "").toLowerCase().match(/[\w.+-]+@[\w-]+\.[\w.-]+/g) || [];
  const phonesIn = (s: string): string[] => (String(s || "").match(/\+?[\d][\d().\s-]{8,}\d/g) || []).map((x) => x.trim());
  const set: Record<string, unknown> = {};

  if (merged.name && merged.name !== prev.name) {
    set.display_name = merged.name;
    set.first_name = merged.firstName || null;
    set.last_name = merged.lastName || null;
  }
  if ((merged.email || "") !== (prev.email || "")) {
    const oldSet = new Set(emailsIn(prev.email)), newList = emailsIn(merged.email);
    const removed = [...oldSet].filter((e) => !newList.includes(e));
    let list = (c.emails || []).filter((e) => !removed.includes(String(e).toLowerCase()));
    for (const e of newList) if (!list.map((x) => String(x).toLowerCase()).includes(e)) list = [e, ...list];
    set.emails = list;
  }
  if ((merged.phone || "") !== (prev.phone || "")) {
    const oldSet = new Set(phonesIn(prev.phone).map(d10)), newList = phonesIn(merged.phone);
    const kept = newList.map(d10);
    const removed = [...oldSet].filter((x) => !kept.includes(x));
    let list = (c.phones || []).filter((x) => !removed.includes(d10(x)));
    for (const ph of newList) if (!list.some((x) => d10(x) === d10(ph))) list = [ph, ...list];
    set.phones = list;
  }
  if ((merged.address || "") !== (prev.address || "")) {
    const addr = merged.address || "";
    const m = addr.match(/^(.*?),\s*([^,]+?),?\s*([A-Z]{2})\s*(\d{5})?/);
    set.address = m ? m[1] : addr || null; set.city = m?.[2] || null; set.state = m?.[3] || null; set.zip = m?.[4] || null;
  }
  if (!Object.keys(set).length) return id;

  const r = await call("/api/clients/contact", { method: "POST", body: JSON.stringify({ id, set, who, app: "Sales App" }) });
  if (!r || !r.ok) { console.warn(`[crm] contact correction ${r ? r.status : "unreachable"} for ${merged.id}`); return id; }
  return id;
}

/** A human note from the sales app → CRM timeline event (idempotent on ext_id). */
export async function crmNote(clientId: number, note: { at: string; who: string; text: string; leadId: string; type?: string }): Promise<boolean> {
  const r = await call("/api/clients/events", {
    method: "POST",
    body: JSON.stringify({ client_id: clientId, events: [{ ext_id: `salesapp:${note.leadId}:${note.at}`, date: note.at.slice(0, 10), type: note.type || "note", title: `${note.who}: ${note.text.replace(/\s+/g, " ").slice(0, 120)}`, detail: note.text.slice(0, 4000), source: "Sales App" }] }),
  });
  return !!r && r.ok;
}
