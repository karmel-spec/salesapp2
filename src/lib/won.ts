/**
 * WON handoff (Brigham, 2026-10-07). When a lead flips to Won, the rep fills a
 * short wizard — showroom sale or shop project — and the answers go to the
 * admin team (info@/melissa@) and the shop (shop@) as one email, plus the
 * Leads Log, the CRM, the Client Portal (shop projects), QuickBooks (customer +
 * draft invoice) and the Store Map parking lot ("piano coming").
 *
 * Everything here is pure data + rendering so the wizard (client) and the
 * send route (server) build the identical preview/email. Supabase access
 * lives at the bottom and is server-only (service key).
 */

export type Branch = "showroom" | "shop";

/** One answered question: a choice value plus an optional note that stays attached to that question. */
export interface Item { v: string; note?: string }

export interface HandoffPiano {
  serial: string;
  label: string; // "2019 Hailun HG-178 6'" — from the Piano Log pick or typed
  year?: string; make?: string; model?: string; size?: string; type?: string;
  row?: number; // Piano Log row when picked from the log
  price?: string; // list price from the log
  note?: string;
}

export interface Handoff {
  branch: Branch;
  closer: string;
  piano: HandoffPiano;
  price: Item; // v = final/quoted price text ("$14,500"), note
  items: Record<string, Item>;
  upsellAt50: boolean; // shop: put the owner back in Brigham's Top Ten at 50% complete
  /** Contact details confirmed/filled in the wizard — written back to the lead (and so the CRM). */
  contact: { phone: string; email: string; address: string };
  /** Delivery address: same as the pickup / customer address, a different one, or not discussed. */
  delivery: { same: "yes" | "no" | "nd" | ""; address: string };
  contacts: string;
  notes: string;
  qbo: boolean; // create the QBO customer + draft invoice
}

export interface Choice { v: string; label: string }
export interface Question {
  id: string;
  label: string;
  choices: Choice[];
  branch: Branch | "both";
  step: "deal" | "money" | "logistics" | "team";
  /** Which to-do list a non-settled answer lands on. */
  owner: "admin" | "shop" | "none";
  /** Choice values that mean "nothing for anyone to do". */
  settled?: string[];
  /** To-do text per choice value (owner's list). */
  todo?: Record<string, string>;
  hint?: string;
}

export const ND: Choice = { v: "nd", label: "Not discussed" };
export const TBD: Choice = { v: "tbd", label: "Price TBD" };
const YES: Choice = { v: "yes", label: "Yes" };
const NO: Choice = { v: "no", label: "No" };

export const QUESTIONS: Question[] = [
  // ---- Deal
  { id: "bench", label: "Bench included?", choices: [YES, NO, ND, TBD], branch: "both", step: "deal", owner: "admin", settled: ["no", "nd"], todo: { yes: "Bench included — add it to the invoice / pull a bench", tbd: "Bench price TBD — quote the customer" } },
  { id: "tech", label: "Technology add-on (QRS / SilentPlay / PianoDisc)?", choices: [YES, NO, ND, TBD], branch: "both", step: "deal", owner: "admin", settled: ["no", "nd"], todo: { yes: "Technology add-on sold — order and schedule the install", tbd: "Technology add-on price TBD — quote the customer" } },
  { id: "techInstall", label: "Install", choices: [{ v: "scheduled", label: "Already scheduled" }, { v: "admin", label: "Admin schedules" }, ND], branch: "both", step: "deal", owner: "admin", settled: ["scheduled"], todo: { admin: "Schedule the technology install", nd: "Technology install not discussed — schedule it" } },
  { id: "track", label: "Restoration level", choices: [{ v: "Rebuild", label: "Rebuild" }, { v: "Hybrid", label: "Hybrid" }, { v: "Refurbish", label: "Refurbish" }, { v: "Refinish", label: "Refinish only" }, { v: "Player", label: "Player" }, { v: "Misc", label: "Misc shop work" }, ND], branch: "shop", step: "deal", owner: "none" },
  { id: "refinish", label: "Refinishing", choices: [{ v: "yes", label: "Sold" }, { v: "no", label: "Declined" }, { v: "upsell", label: "Upsell at 50%" }, ND, TBD], branch: "shop", step: "deal", owner: "admin", settled: ["no", "nd"], todo: { yes: "Refinishing sold — get the color selection", upsell: "Refinishing upsell planned at 50% — flag it on the project", tbd: "Refinishing price TBD — quote the customer" } },
  { id: "selections", label: "Selections (keytops, color, hardware)", choices: [{ v: "committed", label: "Committed" }, { v: "admin", label: "Admin obtains" }, ND], branch: "shop", step: "deal", owner: "admin", settled: ["committed"], todo: { admin: "Obtain the client's selections (portal form)", nd: "Selections not discussed — send the selections form" } },
  { id: "queueStart", label: "Queue speed — work starts in", choices: [{ v: "~1 month", label: "~1 month" }, { v: "~2 months", label: "~2 months" }, { v: "~3 months", label: "~3 months" }, { v: "~6 months", label: "~6 months" }, ND], branch: "shop", step: "deal", owner: "none", hint: "What Brigham told them. Add a note for the exact promise." },
  { id: "complete", label: "100% complete by", choices: [{ v: "~3 months", label: "~3 months" }, { v: "~6 months", label: "~6 months" }, { v: "~9 months", label: "~9 months" }, { v: "~12 months", label: "~12 months" }, ND], branch: "shop", step: "deal", owner: "none" },
  { id: "scope", label: "Scope of work", choices: [], branch: "shop", step: "deal", owner: "none", hint: "What's included, what isn't." },
  // ---- Money
  { id: "deposit", label: "$1,000 queue deposit", choices: [{ v: "collected", label: "Collected" }, { v: "admin", label: "Admin collects" }, ND], branch: "shop", step: "money", owner: "admin", settled: ["collected"], todo: { admin: "Collect the $1,000 queue deposit", nd: "Queue deposit not discussed — collect $1,000 to enter the queue" } },
  { id: "payment", label: "Payment arrangement", choices: [{ v: "full", label: "Paid in full" }, { v: "deposit", label: "Down payment received" }, { v: "collect", label: "Admin collects" }, { v: "finance", label: "Financing" }, { v: "thirdparty", label: "Insurance / other payer" }, { v: "other", label: "Other" }, ND], branch: "showroom", step: "money", owner: "admin", settled: ["full"], todo: { deposit: "Collect the balance", collect: "Collect payment", finance: "Send the financing paperwork and follow up", thirdparty: "Bill the insurance company / other payer", other: "Payment arrangement — see note", nd: "Payment not discussed — reach out" } },
  { id: "payment", label: "Payment arrangement", choices: [{ v: "full", label: "Paid in full" }, { v: "milestones", label: "$1,000 queue, then 25% at start / 25% / 50% / 75% complete" }, { v: "finance", label: "Financing" }, { v: "thirdparty", label: "Insurance / other payer" }, { v: "other", label: "Other" }, ND], branch: "shop", step: "money", owner: "admin", settled: ["full"], todo: { milestones: "Set up the 25% milestone payment schedule in the portal", finance: "Send the financing paperwork and follow up", thirdparty: "Bill the insurance company / other payer", other: "Payment arrangement — see note", nd: "Payment arrangement not discussed — set it up" } },
  { id: "received", label: "Received so far", choices: [], branch: "both", step: "money", owner: "none", hint: "Amount, how, when — e.g. $2,000 card 10/7" },
  { id: "invoice", label: "Invoice", choices: [{ v: "made", label: "Already made" }, { v: "admin", label: "Admin makes it" }, ND], branch: "both", step: "money", owner: "admin", settled: ["made"], todo: { admin: "Create and send the invoice", nd: "Invoice not discussed — create and send it" } },
  // ---- Logistics
  { id: "delivery", label: "Pickup & delivery", choices: [{ v: "included", label: "Included" }, { v: "separate", label: "Quoted separately" }, { v: "customer", label: "Customer handles it" }, ND, TBD], branch: "both", step: "logistics", owner: "admin", settled: ["customer"], todo: { included: "Schedule delivery (included)", separate: "Invoice the delivery and schedule it", nd: "Delivery not discussed — quote and schedule it", tbd: "Delivery price TBD — quote the customer" } },
  { id: "deliverySched", label: "Delivery date", choices: [{ v: "scheduled", label: "Scheduled" }, { v: "admin", label: "Admin schedules" }, ND], branch: "both", step: "logistics", owner: "admin", settled: ["scheduled"], todo: { admin: "Schedule the delivery / pickup with the customer", nd: "Delivery date not discussed — schedule it" }, hint: "Add the date, stairs, gate code, room in the note." },
  { id: "qc", label: "Ready for delivery?", choices: [{ v: "ready", label: "Ready now" }, { v: "qc", label: "QC needed" }, ND], branch: "showroom", step: "logistics", owner: "shop", settled: ["ready"], todo: { qc: "QC the piano before delivery", nd: "Readiness not discussed — QC before delivery" } },
  { id: "tuning", label: "Tuning before delivery?", choices: [YES, NO, ND], branch: "showroom", step: "logistics", owner: "shop", settled: ["no", "nd"], todo: { yes: "Tune before delivery" } },
  { id: "service", label: "Service / fix requests for the shop", choices: [], branch: "both", step: "logistics", owner: "shop", hint: "Sticky keys, pedal squeak, lid ding — anything promised." },
  // ---- Team
  { id: "special", label: "Special requests", choices: [], branch: "both", step: "team", owner: "none", hint: "Keep grandma's bench top, don't sand the carved initials…" },
];

export const CHOICE_LABEL = (q: Question, v: string): string => (q.choices.find((c) => c.v === v)?.label || v || "—");

export function questionsFor(branch: Branch, step?: Question["step"]): Question[] {
  return QUESTIONS.filter((q) => (q.branch === "both" || q.branch === branch) && (!step || q.step === step));
}

export function emptyHandoff(closer: string, contact = { phone: "", email: "", address: "" }): Handoff {
  return { branch: "showroom", closer, piano: { serial: "", label: "" }, price: { v: "" }, items: {}, upsellAt50: true, contact, delivery: { same: "", address: "" }, contacts: "", notes: "", qbo: true };
}

/** Where the piano goes: the customer address, a different address, or still unknown. */
export function deliveryAddress(h: Handoff): { text: string; known: boolean } {
  const base = (h.contact?.address || "").trim();
  if (h.delivery?.same === "no" && h.delivery.address.trim()) return { text: h.delivery.address.trim(), known: true };
  if (h.delivery?.same === "yes" && base) return { text: `${base} (same as ${h.branch === "shop" ? "pickup" : "customer address"})`, known: true };
  if (h.delivery?.same === "yes") return { text: "same as the customer address (address not on file yet)", known: false };
  if (h.delivery?.same === "no") return { text: "different from pickup — address not captured", known: false };
  return { text: "not discussed", known: false };
}

export const priceCents = (v: string): number | null => {
  const m = /\$?\s*(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(k)?/i.exec(v || "");
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, "")) * (m[2] ? 1000 : 1);
  return isFinite(n) && n > 0 && n < 5_000_000 ? Math.round(n * 100) : null;
};
export const money = (cents: number | null | undefined) => (cents ? `$${(cents / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}` : "");

/** To-do lists derived from the answers: admin vs shop manager. */
export function todos(h: Handoff): { admin: string[]; shop: string[] } {
  const admin: string[] = [], shop: string[] = [];
  for (const q of questionsFor(h.branch)) {
    const it = h.items[q.id];
    const v = it?.v || "";
    const note = it?.note?.trim();
    if (q.choices.length === 0) {
      // free-text questions: a filled note = a task for the owner
      if (note && q.owner !== "none") (q.owner === "admin" ? admin : shop).push(`${q.label}: ${note}`);
      continue;
    }
    if (!v) continue; // skipped
    if (q.settled?.includes(v)) continue;
    const text = q.todo?.[v];
    if (!text || q.owner === "none") continue;
    (q.owner === "admin" ? admin : shop).push(note ? `${text} — ${note}` : text);
  }
  if (h.branch === "shop") {
    shop.push(`Piano coming for shop work${h.piano.label ? `: ${h.piano.label}` : ""}${h.piano.serial ? ` (serial ${h.piano.serial})` : " (serial not obtained yet)"} — watch for the pickup`);
    admin.push("Send the Client Portal welcome email (drafted in the portal outbox)");
    if (h.upsellAt50) admin.push("At 50% complete: Brigham's upsell call lands in his Top Ten automatically — confirm the Store Map phase is kept current");
  } else {
    shop.push(`Pull ${h.piano.label || "the sold piano"}${h.piano.serial ? ` (serial ${h.piano.serial})` : ""} from the floor when delivery is set`);
  }
  if (h.piano.note) shop.push(`Piano note: ${h.piano.note}`);
  const missing = [!h.contact?.phone?.trim() && "phone", !h.contact?.email?.trim() && "email", !h.contact?.address?.trim() && "address"].filter(Boolean);
  if (missing.length) admin.push(`Get the customer's ${missing.join(", ")} (not on the lead)`);
  const d = deliveryAddress(h);
  if (!d.known && h.items.delivery?.v !== "customer") admin.push(`Confirm the delivery address (${d.text})`);
  if (h.contacts.trim()) admin.push(`Other contacts: ${h.contacts.trim()}`);
  return { admin, shop };
}

export interface HandoffLinks { lead?: string; crm?: string; portal?: string; qbo?: string; storemap?: string; ackAdmin?: string; ackShop?: string }

/** The email body (plain text with [label](url) links — the mailer renders both parts). Also the wizard's preview. */
export function renderHandoff(h: Handoff, lead: { name: string; email?: string; phone?: string; address?: string }, links: HandoffLinks = {}): { subject: string; body: string } {
  const kind = h.branch === "shop" ? "Shop project" : "Showroom sale";
  const price = h.price.v?.trim() || "price not specified";
  const subject = `WON · ${lead.name} · ${kind} · ${price}`;
  const t = todos(h);
  const L: string[] = [];
  L.push(`${kind} closed by ${h.closer || "the rep"} — ${lead.name}`);
  const c = { phone: h.contact?.phone || lead.phone, email: h.contact?.email || lead.email, address: h.contact?.address || lead.address };
  L.push([c.phone, c.email, c.address].filter(Boolean).join(" · ") || "(no contact details on the lead)");
  const miss = [!c.phone && "phone", !c.email && "email", !c.address && "address"].filter(Boolean);
  if (miss.length) L.push(`  ⚠ missing: ${miss.join(", ")}`);
  L.push("");
  L.push(`PIANO: ${h.piano.label || "not specified"}${h.piano.serial ? ` · serial ${h.piano.serial}` : h.branch === "shop" ? " · serial not obtained" : ""}${h.piano.note ? `\n  note: ${h.piano.note}` : ""}`);
  L.push(`PRICE: ${price}${h.price.note ? `\n  note: ${h.price.note}` : ""}`);
  L.push("");
  L.push("ADMIN TO-DO (info@ / Melissa):");
  L.push(...(t.admin.length ? t.admin.map((x) => `  ☐ ${x}`) : ["  (nothing — all settled)"]));
  L.push("");
  L.push("SHOP MANAGER TO-DO (Mark):");
  L.push(...(t.shop.length ? t.shop.map((x) => `  ☐ ${x}`) : ["  (nothing)"]));
  L.push("");
  const steps: Question["step"][] = ["deal", "money", "logistics", "team"];
  const names: Record<Question["step"], string> = { deal: "THE DEAL", money: "MONEY", logistics: "LOGISTICS", team: "FOR THE TEAM" };
  for (const s of steps) {
    const qs = questionsFor(h.branch, s);
    const lines: string[] = [];
    for (const q of qs) {
      const it = h.items[q.id];
      if (!it || (!it.v && !it.note)) continue;
      const val = q.choices.length ? CHOICE_LABEL(q, it.v) : it.note || "";
      lines.push(`  ${q.label}: ${val}${q.choices.length && it.note ? ` — ${it.note}` : ""}`);
    }
    if (s === "logistics") lines.push(`  Delivery address: ${deliveryAddress(h).text}`);
    if (s === "team") {
      if (h.branch === "shop") lines.push(`  Brigham's 50% upsell call: ${h.upsellAt50 ? "YES — back into his Top Ten at 50%" : "no"}`);
      if (h.contacts.trim()) lines.push(`  Other contacts: ${h.contacts.trim()}`);
      if (h.notes.trim()) lines.push(`  Notes: ${h.notes.trim()}`);
    }
    if (lines.length) { L.push(`${names[s]}:`); L.push(...lines); L.push(""); }
  }
  const skipped = questionsFor(h.branch).filter((q) => q.choices.length && !h.items[q.id]?.v).map((q) => q.label);
  if (skipped.length) { L.push(`Not answered (ask if it matters): ${skipped.join(" · ")}`); L.push(""); }
  const refs: string[] = [];
  if (links.qbo) refs.push(`[QuickBooks invoice (draft, ready to send)](${links.qbo})`);
  if (links.portal) refs.push(`[Client Portal project](${links.portal})`);
  if (links.crm) refs.push(`[CRM client](${links.crm})`);
  if (links.lead) refs.push(`[Sales App lead](${links.lead})`);
  if (links.storemap) refs.push(`[Store Map](${links.storemap})`);
  if (refs.length) { L.push("LINKS: " + refs.join(" · ")); L.push(""); }
  if (links.ackAdmin || links.ackShop) {
    L.push("Please acknowledge so the sales side knows it's in good hands:");
    if (links.ackAdmin) L.push(`  Admin: [Got it, I'm on it](${links.ackAdmin})`);
    if (links.ackShop) L.push(`  Shop manager: [Got it, I'm on it](${links.ackShop})`);
  }
  return { subject, body: L.join("\n") };
}

/** Label/value pairs grouped by section — what the Client Portal and Store Map card pin on top. */
export function handoffLines(h: Handoff): { section: string; label: string; value: string }[] {
  const out: { section: string; label: string; value: string }[] = [];
  const names: Record<Question["step"], string> = { deal: "The deal", money: "Money", logistics: "Logistics", team: "For the team" };
  out.push({ section: "The deal", label: "Piano", value: `${h.piano.label || "not specified"}${h.piano.serial ? ` · serial ${h.piano.serial}` : ""}${h.piano.note ? ` — ${h.piano.note}` : ""}` });
  out.push({ section: "The deal", label: "Price", value: `${h.price.v || "not specified"}${h.price.note ? ` — ${h.price.note}` : ""}` });
  for (const q of questionsFor(h.branch)) {
    const it = h.items[q.id];
    if (!it || (!it.v && !it.note)) continue;
    out.push({ section: names[q.step], label: q.label.replace(/\?$/, ""), value: q.choices.length ? `${CHOICE_LABEL(q, it.v)}${it.note ? ` — ${it.note}` : ""}` : it.note || "" });
  }
  out.push({ section: "Logistics", label: "Delivery address", value: deliveryAddress(h).text });
  if (h.branch === "shop") out.push({ section: "For the team", label: "Brigham's 50% upsell call", value: h.upsellAt50 ? "Yes — back into his Top Ten at 50%" : "No" });
  if (h.contacts.trim()) out.push({ section: "For the team", label: "Other contacts", value: h.contacts.trim() });
  if (h.notes.trim()) out.push({ section: "For the team", label: "Notes", value: h.notes.trim() });
  return out;
}

/** Compact one-paragraph version for the lead timeline / CRM note. */
export function summarize(h: Handoff): string {
  const parts: string[] = [];
  parts.push(`${h.branch === "shop" ? "Shop project" : "Showroom sale"} · ${h.price.v || "price n/a"}`);
  if (h.piano.label) parts.push(`${h.piano.label}${h.piano.serial ? ` #${h.piano.serial}` : ""}`);
  for (const q of questionsFor(h.branch)) {
    const it = h.items[q.id];
    if (!it || (!it.v && !it.note)) continue;
    parts.push(`${q.label.replace(/\?$/, "")}: ${q.choices.length ? CHOICE_LABEL(q, it.v) : it.note}${q.choices.length && it.note ? ` (${it.note})` : ""}`);
  }
  if (h.branch === "shop") parts.push(`50% upsell call: ${h.upsellAt50 ? "yes" : "no"}`);
  if (h.contacts.trim()) parts.push(`contacts: ${h.contacts.trim()}`);
  if (h.notes.trim()) parts.push(`notes: ${h.notes.trim()}`);
  return parts.join(" · ");
}

// ---------------------------------------------------------------- server side

export interface HandoffRow {
  id: string; created_at: string; updated_at: string; lead_id: string; lead_name: string; closed_by: string; branch: Branch;
  serial: string | null; piano: string | null; piano_type: string | null; price_cents: number | null; answers: Handoff; summary_text: string | null;
  client_email: string | null; client_phone: string | null; crm_client_id: number | null; portal_project_id: string | null;
  qbo_customer_id: string | null; qbo_invoice_id: string | null; qbo_invoice_url: string | null; qbo_status: string | null;
  email_sent_at: string | null; email_to: string | null; admin_ack_at: string | null; admin_ack_by: string | null; shop_ack_at: string | null; shop_ack_by: string | null;
  nudged_at: string | null; nudge_count: number; upsell_followup: boolean; upsell_triggered_at: string | null; upsell_lead_id: string | null; arrived_at: string | null;
  log: { at: string; text: string; ok?: boolean }[];
}

const SB_URL = process.env.SUPABASE_URL || "";
const SB_KEY = process.env.SUPABASE_SERVICE_KEY || "";
export const handoffStoreReady = () => Boolean(SB_URL && SB_KEY);

async function sb<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!handoffStoreReady()) throw new Error("Supabase not configured (SUPABASE_URL / SUPABASE_SERVICE_KEY)");
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "content-type": "application/json", Prefer: "return=representation", ...(init.headers || {}) },
    signal: AbortSignal.timeout(10000),
    cache: "no-store",
  });
  if (!r.ok) throw new Error(`won_handoffs ${init.method || "GET"} ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return (r.status === 204 ? null : await r.json()) as T;
}

export const newHandoffId = () => `wh${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;

export async function insertHandoff(row: Partial<HandoffRow> & { id: string }): Promise<HandoffRow> {
  const r = await sb<HandoffRow[]>("won_handoffs", { method: "POST", body: JSON.stringify(row) });
  return r[0];
}
export async function patchHandoff(id: string, patch: Partial<HandoffRow>): Promise<HandoffRow | null> {
  const r = await sb<HandoffRow[]>(`won_handoffs?id=eq.${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }) });
  return r?.[0] || null;
}
export async function getHandoff(id: string): Promise<HandoffRow | null> {
  const r = await sb<HandoffRow[]>(`won_handoffs?id=eq.${encodeURIComponent(id)}&limit=1`);
  return r[0] || null;
}
export async function handoffsForLead(leadId: string): Promise<HandoffRow[]> {
  return sb<HandoffRow[]>(`won_handoffs?lead_id=eq.${encodeURIComponent(leadId)}&order=created_at.desc`);
}
export async function listHandoffs(filter: string): Promise<HandoffRow[]> {
  return sb<HandoffRow[]>(`won_handoffs?${filter}`);
}
export async function logHandoff(row: HandoffRow | null, text: string, ok = true): Promise<void> {
  if (!row) return;
  const log = [...(row.log || []), { at: new Date().toISOString(), text: text.slice(0, 300), ok }].slice(-40);
  row.log = log;
  try { await patchHandoff(row.id, { log }); } catch { /* best effort */ }
}

/** Signed "Got it" link token: nobody outside the email can acknowledge for someone else. */
export async function ackToken(id: string, role: "admin" | "shop"): Promise<string> {
  const { createHmac } = await import("crypto");
  const secret = process.env.BLP_INTEGRATION_KEY || process.env.BLP_APP_ACCESS_KEY || "pianoman";
  return createHmac("sha256", secret).update(`${id}:${role}`).digest("hex").slice(0, 24);
}
