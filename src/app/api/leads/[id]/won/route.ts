import { NextRequest, NextResponse } from "next/server";
import { getLead, updateLeadFields, appendTimeline } from "@/lib/leads";
import { requireSession, jsonError } from "@/lib/api";
import { config } from "@/lib/config";
import { crmUpsertLead, crmNote } from "@/lib/crm";
import { sendEmail } from "@/lib/comms";
import { qboConfigured, findOrCreateCustomer, createInvoice } from "@/lib/qbo";
import { type Handoff, type HandoffRow, renderHandoff, summarize, todos, handoffLines, priceCents, newHandoffId, insertHandoff, patchHandoff, handoffsForLead, handoffStoreReady, ackToken, logHandoff } from "@/lib/won";

export const dynamic = "force-dynamic";
export const maxDuration = 26;

const CRM = process.env.CRM_URL || "https://brighamlarsonpianos.org";
const PORTAL = process.env.CLIENT_PORTAL_URL || "https://blpclientportal.netlify.app";
const KEY = process.env.BLP_INTEGRATION_KEY || process.env.BLP_APP_ACCESS_KEY || "pianoman";
const BRIDGE_URL = process.env.BLP_BRIDGE_URL || "https://script.google.com/macros/s/AKfycbxY4BKnr_Tr0iCTc9itCWhNYLvgszmkI1IoYSkbBWpyAqRtWI-yaUkJQjcVdgG58KXt/exec";
const BRIDGE_PIN = process.env.BLP_BRIDGE_PIN || "";
const HANDOFF_TO = (process.env.WON_HANDOFF_TO || "shop@brighamlarsonpianos.com, info@brighamlarsonpianos.com, melissa@brighamlarsonpianos.com").split(",").map((s) => s.trim()).filter(Boolean);
const SHOP_MANAGER = process.env.WON_SHOP_MANAGER || "Mark Hales";
const SB_URL = process.env.SUPABASE_URL || "";
const SB_KEY = process.env.SUPABASE_SERVICE_KEY || "";

/** The latest handoff for this lead (lead page status card + wizard prefill). */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = requireSession(req);
  if (guard) return guard;
  try {
    const { id } = await ctx.params;
    if (!handoffStoreReady()) return NextResponse.json({ handoff: null, configured: false });
    const rows = await handoffsForLead(id);
    return NextResponse.json({ handoff: rows[0] || null, configured: true, qbo: qboConfigured() });
  } catch (err) {
    return jsonError(err);
  }
}

const withTimeout = <T,>(p: Promise<T>, ms: number, label: string): Promise<T> =>
  Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`${label} timed out after ${ms / 1000}s`)), ms))]);

/** Mark the lead Won and run the handoff: email, Leads Log, CRM, Client Portal, QBO, Piano Log, task board. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = requireSession(req);
  if (guard) return guard;
  try {
    const { id } = await ctx.params;
    const body = (await req.json()) as { handoff?: Handoff; who?: string; resend?: string };
    const h = body.handoff;
    if (!h || (h.branch !== "showroom" && h.branch !== "shop")) return NextResponse.json({ error: "handoff.branch must be showroom or shop" }, { status: 400 });
    const found = await getLead(id, true);
    if (!found) return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    const lead = found.lead;
    const who = (body.who || h.closer || "app").trim();
    h.closer = (h.closer || who).trim();
    const warnings: string[] = [];
    const warn = (s: string) => { warnings.push(s); console.warn(`[won] ${lead.id}: ${s}`); };

    // 1. Leads Log: status Won + closer + final price (one write).
    const fields: Record<string, string> = {};
    if (lead.statusBucket !== "won") fields.status = "Won";
    if (h.closer && h.closer !== lead.closedBy) fields.closedBy = h.closer;
    const cents = priceCents(h.price.v || "");
    if (cents && !lead.value.trim()) fields.value = `$${(cents / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
    if (h.piano.type && !lead.pianoType.trim()) fields.pianoType = h.piano.type;
    if (Object.keys(fields).length) {
      await updateLeadFields(lead, found.shape, fields as Partial<Record<"status" | "closedBy" | "value" | "pianoType", string>>);
      // The same "Updated status" edit the inline editor logs — the WON celebration and win tallies key off it.
      await appendTimeline(lead, found.shape, { at: new Date().toISOString(), who, kind: "edit", text: `Updated ${Object.keys(fields).join(", ")} (Won)` });
    }

    // 2. Handoff record (Supabase) — the system of record for this handoff.
    const hid = body.resend || newHandoffId();
    const contact = { name: lead.name, email: lead.emailClean || lead.email, phone: lead.phoneDialable || lead.phone, address: lead.address };
    let row: HandoffRow | null = null;
    if (handoffStoreReady()) {
      try {
        const base: Partial<HandoffRow> = { lead_id: lead.id, lead_name: lead.name, closed_by: h.closer, branch: h.branch, serial: h.piano.serial || null, piano: h.piano.label || null, piano_type: h.piano.type || lead.pianoType || null, price_cents: cents, answers: h, summary_text: summarize(h), client_email: contact.email || null, client_phone: contact.phone || null, upsell_followup: h.branch === "shop" && h.upsellAt50 };
        row = body.resend ? await patchHandoff(hid, base) : await insertHandoff({ id: hid, ...base });
      } catch (e) { warn(`Handoff record not saved: ${e instanceof Error ? e.message : String(e)}`); }
    } else warn("Supabase not configured — handoff record not saved (email still goes out)");

    // 3. The slow outside systems in parallel, each with its own budget.
    const links: { lead: string; crm?: string; portal?: string; qbo?: string; storemap?: string } = { lead: `${config.publicBaseUrl}/leads/${encodeURIComponent(lead.id)}`, storemap: "https://blpstoremap.netlify.app/" };
    const patch: Partial<HandoffRow> = {};
    const jobs: Promise<void>[] = [];

    // CRM: client + a "sale" event (CRM owns the person).
    jobs.push((async () => {
      try {
        const cid = await withTimeout(crmUpsertLead(lead), 9000, "CRM");
        if (!cid) { warn("CRM: client not resolved"); return; }
        links.crm = `${CRM}/clients?id=${cid}`; patch.crm_client_id = cid;
        await crmNote(cid, { at: new Date().toISOString(), who: h.closer, text: `WON — ${summarize(h)}`, leadId: lead.id, type: "sale" });
        await tagCustomer(contact, h.branch === "shop" ? "Shop Project Customer" : "Showroom Customer");
      } catch (e) { warn(`CRM: ${e instanceof Error ? e.message : String(e)}`); }
    })());

    // Client Portal: shop projects get a project with the handoff pinned on top.
    if (h.branch === "shop") jobs.push((async () => {
      try {
        const r = await fetch(`${PORTAL}/api/projects/from-sale`, { method: "POST", headers: { "content-type": "application/json", "x-blp-key": KEY }, body: JSON.stringify({ lead: { id: lead.id, name: lead.name, first: lead.firstName, last: lead.lastName, email: contact.email, phone: contact.phone, address: lead.address, leadType: lead.leadType, pianoType: h.piano.type || lead.pianoType, value: h.price.v || lead.value, rep: h.closer, headline: lead.headline, notes: lead.notes }, handoff: h, handoff_id: hid, todos: todos(h), lines: handoffLines(h), closer: h.closer }), signal: AbortSignal.timeout(14000) });
        const j = (await r.json().catch(() => ({}))) as { project?: string; url?: string; existing?: boolean; error?: string };
        if (!r.ok) { warn(`Client Portal: ${j.error || r.status}`); return; }
        links.portal = j.url || `${PORTAL}/admin/projects/${j.project}`; patch.portal_project_id = j.project || null;
      } catch (e) { warn(`Client Portal: ${e instanceof Error ? e.message : String(e)}`); }
    })());

    // QuickBooks: customer + DRAFT invoice (admin sends it from QBO after review).
    if (h.qbo && cents) jobs.push((async () => {
      if (!qboConfigured()) { patch.qbo_status = "not connected"; warn("QuickBooks not connected — invoice not drafted (set QBO_CLIENT_ID/SECRET, then /api/qbo/connect)"); return; }
      try {
        const cust = await withTimeout(findOrCreateCustomer({ name: lead.name, email: contact.email || undefined, phone: contact.phone || undefined, address: lead.address || undefined }), 9000, "QBO customer");
        const desc = h.branch === "shop" ? `Piano ${h.items.track?.v || "shop work"}${h.piano.label ? ` — ${h.piano.label}` : ""}${h.piano.serial ? ` (serial ${h.piano.serial})` : ""}` : `${h.piano.label || "Piano"}${h.piano.serial ? ` (serial ${h.piano.serial})` : ""}${h.items.bench?.v === "yes" ? " — bench included" : ""}`;
        const inv = await withTimeout(createInvoice({ customerId: cust.Id, email: contact.email || undefined, lines: [{ description: desc, amount: cents / 100 }], memo: "Thank you for choosing Brigham Larson Pianos.", privateNote: `Sales App WON handoff ${hid} · closed by ${h.closer}` }), 9000, "QBO invoice");
        links.qbo = inv.url; Object.assign(patch, { qbo_customer_id: cust.Id, qbo_invoice_id: inv.Id, qbo_invoice_url: inv.url, qbo_status: `draft ${inv.DocNumber || inv.Id}` });
      } catch (e) { patch.qbo_status = `failed: ${e instanceof Error ? e.message : String(e)}`.slice(0, 200); warn(`QuickBooks: ${e instanceof Error ? e.message : String(e)}`); }
    })());

    // Piano Log: a showroom piano picked from the log is marked Sold (Store Map bridge, same op the map uses).
    if (h.branch === "showroom" && h.piano.serial && h.piano.row) jobs.push((async () => {
      if (!BRIDGE_PIN) { warn("Piano Log not updated — BLP_BRIDGE_PIN is not set on the sales app"); return; }
      try {
        const r = await fetch(BRIDGE_URL, { method: "POST", redirect: "follow", headers: { "content-type": "text/plain;charset=utf-8" }, body: JSON.stringify({ pin: BRIDGE_PIN, serial: h.piano.serial, row: h.piano.row, action: "setphase", phase: "Sold", buyer: lead.name, note: `Sold to ${lead.name} — ${h.price.v || "price n/a"} (Sales App WON handoff)`, checkBack: "", name: h.closer, email: "" }), signal: AbortSignal.timeout(12000) });
        const j = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string; service?: string };
        if (!j.ok) warn(`Piano Log: ${j.error || (j.service ? "bridge ping (not applied)" : r.status)}`);
      } catch (e) { warn(`Piano Log: ${e instanceof Error ? e.message : String(e)}`); }
    })());

    // Shop manager's task board card with his to-dos (Store Map board, Supabase authority).
    const t = todos(h);
    if (t.shop.length && SB_URL && SB_KEY) jobs.push((async () => {
      try {
        const nowIso = new Date().toISOString();
        const r = await fetch(`${SB_URL}/rest/v1/tb_cards`, { method: "POST", headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "content-type": "application/json", Prefer: "return=minimal" }, body: JSON.stringify({ id: "tc" + Date.now().toString(36) + Math.floor(Math.random() * 1e4), owner: SHOP_MANAGER, col: "todo", text: `WON ${h.branch === "shop" ? "shop project" : "showroom sale"}: ${lead.name}${h.piano.label ? ` — ${h.piano.label}` : ""}`, serial: h.piano.serial || "", due: "", from_who: h.closer, notes: t.shop.map((x) => `☐ ${x}`).join("\n") + (links.lead ? `\n\nSales App: ${links.lead}` : ""), ord: 0, created: nowIso, updated_at: nowIso }), signal: AbortSignal.timeout(8000) });
        if (!r.ok) warn(`Task board card for ${SHOP_MANAGER}: ${r.status}`);
      } catch (e) { warn(`Task board: ${e instanceof Error ? e.message : String(e)}`); }
    })());

    await Promise.allSettled(jobs);

    // 4. The email — one message, three audiences, with signed "Got it" links.
    const ack = row ? { ackAdmin: `${config.publicBaseUrl}/api/won/ack?id=${hid}&role=admin&t=${await ackToken(hid, "admin")}`, ackShop: `${config.publicBaseUrl}/api/won/ack?id=${hid}&role=shop&t=${await ackToken(hid, "shop")}` } : {};
    const mail = renderHandoff(h, contact, { ...links, ...ack });
    try {
      await sendEmail(HANDOFF_TO.join(", "), mail.subject, mail.body);
      patch.email_sent_at = new Date().toISOString(); patch.email_to = HANDOFF_TO.join(", ");
    } catch (e) { warn(`Email: ${e instanceof Error ? e.message : String(e)}`); }

    // 5. Lead timeline (kind "handoff" so it isn't double-pushed to the CRM) + handoff record.
    const fresh = await getLead(id, true);
    await appendTimeline(fresh?.lead || lead, found.shape, { at: new Date().toISOString(), who: h.closer, kind: "handoff", text: `🏆 WON handoff ${patch.email_sent_at ? `sent to ${HANDOFF_TO.map((a) => a.split("@")[0]).join("/")}` : "NOT emailed"} — ${summarize(h)}${links.portal ? ` · Portal: ${links.portal}` : ""}${links.qbo ? ` · QBO draft invoice: ${links.qbo}` : ""}${warnings.length ? ` · Warnings: ${warnings.join("; ")}` : ""}` });
    if (row) { await patchHandoff(hid, patch).catch(() => null); for (const w of warnings) await logHandoff(row, w, false); await logHandoff(row, `Handoff ${body.resend ? "re-sent" : "sent"} by ${who}`); }

    return NextResponse.json({ ok: true, id: hid, links, warnings, emailed: Boolean(patch.email_sent_at), to: HANDOFF_TO });
  } catch (err) {
    return jsonError(err);
  }
}

/** CRM tag for the customer (category "Customer") — resolve is additive, so this only adds the tag; best effort. */
async function tagCustomer(c: { name: string; email?: string; phone?: string }, tag: string): Promise<void> {
  try {
    await fetch(`${CRM}/api/clients/resolve`, { method: "POST", headers: { "content-type": "application/json", "x-blp-key": KEY }, body: JSON.stringify({ name: c.name, email: c.email || undefined, phone: c.phone || undefined, tag, tag_category: "Customer", source: "Sales App" }), signal: AbortSignal.timeout(6000) });
  } catch { /* tag is a nice-to-have */ }
}

