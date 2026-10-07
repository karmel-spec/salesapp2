"use client";

import { useEffect, useMemo, useState } from "react";
import type { Lead } from "@/lib/leads";
import { api } from "@/lib/client";
import { TypeAhead } from "@/components/TypeAhead";
import { type Handoff, type Item, type Question, emptyHandoff, questionsFor, renderHandoff, todos } from "@/lib/won";

interface PickPiano { serial: string; row: number; year: string; make: string; model: string; size: string; category: string; price: string; location: string; section: string; sellable: boolean; forSale: boolean; label: string }

const STEPS = ["Branch", "Contact", "Piano", "Deal", "Money", "Logistics", "Team", "Send"] as const;
const PIANO_TYPES = ["Upright", "Tall Upright", "Grand", "Baby Grand", "Spinet", "Console", "Player Piano", "Digital", "Heirloom / family piano"];

/**
 * WON handoff wizard (Brigham picked design B, 2026-10-07): six short steps
 * and an email preview. Everything is skippable — only the branch is needed.
 * Each question takes a choice (Yes / No / Not discussed / Price TBD…) and
 * its own note, so bench notes stay with the bench, delivery notes with
 * delivery.
 */
export function WonWizard({ lead, who, initial, resendId, onClose, onSent, onSkip }: { lead: Lead; who: string; initial?: Handoff | null; resendId?: string; onClose: () => void; onSent: (r: { id: string; warnings: string[]; emailed: boolean; to: string[] }) => void; onSkip: () => void }) {
  const leadContact = { phone: lead.phoneDialable || lead.phone || "", email: lead.emailClean || lead.email || "", address: lead.address || "" };
  const [h, setH] = useState<Handoff>(() => {
    const base = { ...emptyHandoff(who || "Brigham", leadContact), branch: (/restoration|refinish|refurbish|qrs|player/i.test(lead.leadType) ? "shop" : "showroom") as Handoff["branch"] };
    if (!initial) return base;
    // Older handoffs (before the Contact step) have no contact/delivery — fall back to the lead's details.
    return { ...base, ...initial, contact: { ...leadContact, ...(initial.contact || {}) }, delivery: initial.delivery || base.delivery };
  });
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [pianos, setPianos] = useState<PickPiano[]>([]);
  const [qbo, setQbo] = useState<{ configured: boolean; connected: boolean } | null>(null);
  const [pianoQuery, setPianoQuery] = useState(h.piano.label || "");

  useEffect(() => {
    api<{ pianos: PickPiano[] }>("/api/pianolog/pianos").then((r) => setPianos(r.pianos)).catch(() => setPianos([]));
    api<{ configured: boolean; connected: boolean }>("/api/qbo/status").then(setQbo).catch(() => setQbo({ configured: false, connected: false }));
  }, []);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);

  const set = (patch: Partial<Handoff>) => setH((x) => ({ ...x, ...patch }));
  const setItem = (id: string, patch: Partial<Item>) => setH((x) => ({ ...x, items: { ...x.items, [id]: { ...(x.items[id] || { v: "" }), ...patch } } }));

  const options = useMemo(() => pianos.map((p) => `${p.label}${p.serial ? ` #${p.serial}` : ""}${p.price ? ` · ${p.price}` : ""}${p.location ? ` · ${p.location}` : ""}`), [pianos]);
  const pickPiano = (text: string) => {
    setPianoQuery(text);
    const i = options.indexOf(text);
    const p = i >= 0 ? pianos[i] : null;
    if (p) set({ piano: { ...h.piano, serial: p.serial, row: p.row, label: p.label, year: p.year, make: p.make, model: p.model, size: p.size, type: /grand/i.test(p.category) ? "Grand" : /digital/i.test(p.category) ? "Digital" : h.piano.type || "Upright", price: p.price }, price: h.price.v ? h.price : { ...h.price, v: p.price || "" } });
    else set({ piano: { ...h.piano, label: text, serial: h.piano.row ? "" : h.piano.serial, row: undefined } });
  };

  const contact = { name: lead.name, email: h.contact.email, phone: h.contact.phone, address: h.contact.address };
  const preview = useMemo(() => renderHandoff(h, contact, { lead: `${typeof location !== "undefined" ? location.origin : ""}/leads/${lead.id}` }), [h, lead.id, contact.name, contact.email, contact.phone, contact.address]);
  const t = useMemo(() => todos(h), [h]);

  async function send() {
    setBusy(true); setErr("");
    try {
      const r = await api<{ ok: boolean; id: string; warnings: string[]; emailed: boolean; to: string[] }>(`/api/leads/${encodeURIComponent(lead.id)}/won`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ handoff: h, who, resend: resendId || undefined }) });
      onSent(r);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }

  const last = STEPS.length - 1;
  const stepKey = (["branch", "contact", "piano", "deal", "money", "logistics", "team", "send"] as const)[step];
  const missing = { phone: !h.contact.phone.trim(), email: !h.contact.email.trim(), address: !h.contact.address.trim() };

  return (
    <div className="wonwiz" role="dialog" aria-modal="true" aria-label="Won handoff">
      <div className="wonwiz-card">
        <header className="wonwiz-head">
          <div className="wonwiz-title">🏆 Won — {lead.name}</div>
          <ol className="wonwiz-steps">
            {STEPS.map((s, i) => <li key={s} className={i < step ? "done" : i === step ? "now" : ""} onClick={() => i < step && setStep(i)}><i>{i < step ? "✓" : i + 1}</i>{s}</li>)}
          </ol>
          <button className="wonwiz-x" aria-label="Close" onClick={onClose}>✕</button>
        </header>

        <div className="wonwiz-body">
          {stepKey === "branch" && (
            <div className="wonwiz-page">
              <div className="ask">What kind of win is this?</div>
              <div className="choices big">
                <label className={h.branch === "showroom" ? "on" : ""}><input type="radio" name="branch" checked={h.branch === "showroom"} onChange={() => set({ branch: "showroom" })} /><b>Showroom sale</b><span>a piano leaves the floor</span></label>
                <label className={h.branch === "shop" ? "on" : ""}><input type="radio" name="branch" checked={h.branch === "shop"} onChange={() => set({ branch: "shop" })} /><b>Shop project</b><span>restoration · refinish · player · misc shop work</span></label>
              </div>
              <div className="ask small">Closed by</div>
              <div className="choices">
                {["Brigham", "Karmel", "Melissa", "Arnold"].map((r) => <label key={r} className={h.closer === r ? "on" : ""}><input type="radio" name="closer" checked={h.closer === r} onChange={() => set({ closer: r })} />{r}</label>)}
                <input className="wonwiz-input" placeholder="someone else…" value={["Brigham", "Karmel", "Melissa", "Arnold"].includes(h.closer) ? "" : h.closer} onChange={(e) => set({ closer: e.target.value })} />
              </div>
              <p className="muted small">Every question after this is skippable. Unanswered items show as "not answered" so admin knows to ask.</p>
            </div>
          )}

          {stepKey === "contact" && (
            <div className="wonwiz-page">
              <div className="ask">How do we reach {lead.firstName || lead.name}?</div>
              {(missing.phone || missing.email || missing.address) ? <p className="small" style={{ color: "#8a6f1a", margin: 0 }}>⚠ Missing on the lead: {[missing.phone && "phone", missing.email && "email", missing.address && "address"].filter(Boolean).join(", ")}. Fill in what you got at the handshake — it saves to the lead and the CRM.</p> : <p className="muted small">All on file. Correct anything that changed.</p>}
              <div className="grid2">
                <label className="fld">Phone{missing.phone && <span className="miss">missing</span>}<input className="wonwiz-input" placeholder="801-555-1234" value={h.contact.phone} onChange={(e) => set({ contact: { ...h.contact, phone: e.target.value } })} /></label>
                <label className="fld">Email{missing.email && <span className="miss">missing</span>}<input className="wonwiz-input" type="email" placeholder="name@example.com" value={h.contact.email} onChange={(e) => set({ contact: { ...h.contact, email: e.target.value } })} /></label>
              </div>
              <label className="fld">{h.branch === "shop" ? "Pickup address (where the piano is now)" : "Customer address"}{missing.address && <span className="miss">missing</span>}<input className="wonwiz-input" placeholder="street, city, state" value={h.contact.address} onChange={(e) => set({ contact: { ...h.contact, address: e.target.value } })} /></label>
              <div className="ask small">{h.branch === "shop" ? "Deliver back to the same address as pickup?" : "Deliver to this address?"}</div>
              <div className="choices">
                {([["yes", "Yes, same address"], ["no", "No — different address"], ["nd", "Not discussed"]] as const).map(([v, label]) => <label key={v} className={h.delivery.same === v ? "on" : ""}><input type="radio" name="delsame" checked={h.delivery.same === v} onChange={() => set({ delivery: { ...h.delivery, same: v } })} />{label}</label>)}
              </div>
              {h.delivery.same === "no" && <label className="fld">Delivery address<input className="wonwiz-input" placeholder="street, city, state — stairs, gate code" value={h.delivery.address} onChange={(e) => set({ delivery: { ...h.delivery, address: e.target.value } })} autoFocus /></label>}
            </div>
          )}

          {stepKey === "piano" && (
            <div className="wonwiz-page">
              {h.branch === "showroom" ? (
                <>
                  <div className="ask">Which piano?</div>
                  <TypeAhead value={pianoQuery} options={options} onChange={pickPiano} placeholder={pianos.length ? "Type a make, model or serial from the Piano Log…" : "Loading the Piano Log…"} ariaLabel="Pick the piano" maxSuggestions={10} />
                  {h.piano.row ? <p className="small ok">✓ {h.piano.label}{h.piano.serial ? ` · serial ${h.piano.serial}` : ""}{h.piano.price ? ` · listed ${h.piano.price}` : ""} — the Piano Log row will be marked Sold.</p> : <p className="muted small">Pick from the list so the Piano Log and Store Map follow along, or just type a description.</p>}
                </>
              ) : (
                <>
                  <div className="ask">The customer's piano</div>
                  <div className="grid2">
                    <label className="fld">Description<input className="wonwiz-input" placeholder="1928 Steinway M, walnut" value={h.piano.label} onChange={(e) => set({ piano: { ...h.piano, label: e.target.value } })} /></label>
                    <label className="fld">Serial number<input className="wonwiz-input" placeholder="if obtained" value={h.piano.serial} onChange={(e) => set({ piano: { ...h.piano, serial: e.target.value.trim() } })} /></label>
                  </div>
                  <p className="muted small">{h.piano.serial ? "With a serial, the Store Map shows it as “piano coming” in the parking lot and the portal links the shop card when it arrives." : "No serial yet — it'll show as “piano coming” by name, and the shop can add the serial on arrival."}</p>
                </>
              )}
              <div className="ask small">Piano type</div>
              <div className="choices">{PIANO_TYPES.map((p) => <label key={p} className={h.piano.type === p ? "on" : ""}><input type="radio" name="ptype" checked={h.piano.type === p} onChange={() => set({ piano: { ...h.piano, type: p } })} />{p}</label>)}</div>
              <label className="fld">Piano note (for the shop)<input className="wonwiz-input" placeholder="light ding on the lid edge, sticky B4…" value={h.piano.note || ""} onChange={(e) => set({ piano: { ...h.piano, note: e.target.value } })} /></label>
            </div>
          )}

          {stepKey === "deal" && (
            <div className="wonwiz-page">
              <div className="ask">What was agreed?</div>
              <div className="grid2">
                <label className="fld">{h.branch === "shop" ? "Price quoted & agreed" : "Final price"}<input className="wonwiz-input" placeholder="$" value={h.price.v} onChange={(e) => set({ price: { ...h.price, v: e.target.value } })} /></label>
                <label className="fld">Price note<input className="wonwiz-input" placeholder="includes bench & delivery…" value={h.price.note || ""} onChange={(e) => set({ price: { ...h.price, note: e.target.value } })} /></label>
              </div>
              {questionsFor(h.branch, "deal").map((q) => <QRow key={q.id} q={q} item={h.items[q.id]} onChange={(p) => setItem(q.id, p)} hidden={q.id === "techInstall" && h.items.tech?.v !== "yes"} />)}
            </div>
          )}

          {stepKey === "money" && (
            <div className="wonwiz-page">
              <div className="ask">Where does the money stand?</div>
              {questionsFor(h.branch, "money").map((q) => <QRow key={q.id} q={q} item={h.items[q.id]} onChange={(p) => setItem(q.id, p)} />)}
              <label className="chk"><input type="checkbox" checked={h.qbo} onChange={(e) => set({ qbo: e.target.checked })} /> Draft the invoice in QuickBooks for admin to send{qbo && !qbo.connected ? <span className="muted"> (QuickBooks isn't connected yet — it will be skipped)</span> : null}</label>
            </div>
          )}

          {stepKey === "logistics" && (
            <div className="wonwiz-page">
              <div className="ask">Getting it {h.branch === "shop" ? "here and back" : "to them"}</div>
              {questionsFor(h.branch, "logistics").map((q) => <QRow key={q.id} q={q} item={h.items[q.id]} onChange={(p) => setItem(q.id, p)} hidden={q.id === "deliverySched" && h.items.delivery?.v === "customer"} />)}
            </div>
          )}

          {stepKey === "team" && (
            <div className="wonwiz-page">
              <div className="ask">Anything the team should know?</div>
              {questionsFor(h.branch, "team").map((q) => <QRow key={q.id} q={q} item={h.items[q.id]} onChange={(p) => setItem(q.id, p)} />)}
              <label className="fld">Other contacts<input className="wonwiz-input" placeholder="spouse, adult child, who to call" value={h.contacts} onChange={(e) => set({ contacts: e.target.value })} /></label>
              <label className="fld">Additional notes<textarea className="wonwiz-input" rows={3} value={h.notes} onChange={(e) => set({ notes: e.target.value })} /></label>
              {h.branch === "shop" && (
                <div className="wonwiz-upsell">
                  <div className="ask small">Brigham's 50% update + upsell call</div>
                  <div className="choices">
                    <label className={h.upsellAt50 ? "on" : ""}><input type="radio" name="up" checked={h.upsellAt50} onChange={() => set({ upsellAt50: true })} />Yes — put this owner back in my Top Ten at 50%</label>
                    <label className={!h.upsellAt50 ? "on" : ""}><input type="radio" name="up" checked={!h.upsellAt50} onChange={() => set({ upsellAt50: false })} />No</label>
                  </div>
                  <p className="muted small">When the Piano Log shows the project past the halfway phase, a fresh lead lands in BL Leads with the original sale attached, so the update call and upsell suggestions happen on time.</p>
                </div>
              )}
            </div>
          )}

          {stepKey === "send" && (
            <div className="wonwiz-page">
              <div className="ask">This is what the team gets</div>
              <div className="wonwiz-to">To: shop@ · info@ · melissa@ &nbsp;·&nbsp; Subject: {preview.subject}</div>
              <pre className="wonwiz-preview">{preview.body}</pre>
              <div className="wonwiz-creates">
                <b>On send:</b> lead → Won · CRM note + customer tag{h.branch === "shop" ? " · Client Portal project with this handoff pinned on top" : ""}{h.qbo && h.price.v ? " · QuickBooks customer + draft invoice" : ""}{h.branch === "showroom" && h.piano.row ? " · Piano Log row marked Sold" : ""}{h.branch === "shop" ? " · Store Map “piano coming” in the parking lot" : ""}{t.shop.length ? " · task card on the shop manager's board" : ""} · "Got it" links for admin and the shop (reminders every 4h until clicked).
              </div>
              {err && <p className="wonwiz-err">{err}</p>}
            </div>
          )}
        </div>

        <footer className="wonwiz-foot">
          <button className="btn ghost small" disabled={step === 0 || busy} onClick={() => setStep((s) => s - 1)}>← Back</button>
          {step === 0 && <button className="btn ghost small" disabled={busy} onClick={onSkip} title="Mark Won without the handoff email">Skip the handoff</button>}
          <span className="spacer" />
          {step < last ? <button className="btn small" onClick={() => setStep((s) => s + 1)}>{step === 0 ? "Start →" : "Next →"}</button> : <button className="btn small" disabled={busy} onClick={send}>{busy ? "Sending…" : resendId ? "Re-send to the team 🏆" : "Send to the team 🏆"}</button>}
        </footer>
      </div>
    </div>
  );
}

/** One question: choice chips + its own note. */
function QRow({ q, item, onChange, hidden }: { q: Question; item?: Item; onChange: (p: Partial<Item>) => void; hidden?: boolean }) {
  const [noteOpen, setNoteOpen] = useState(Boolean(item?.note));
  if (hidden) return null;
  const free = q.choices.length === 0;
  return (
    <div className="qrow">
      <div className="qlbl">{q.label}{q.hint && <span className="muted small"> — {q.hint}</span>}</div>
      {free ? (
        <input className="wonwiz-input" placeholder={q.hint || ""} value={item?.note || ""} onChange={(e) => onChange({ note: e.target.value })} />
      ) : (
        <div className="choices">
          {q.choices.map((c) => <label key={c.v} className={item?.v === c.v ? "on" : ""}><input type="radio" name={q.id} checked={item?.v === c.v} onChange={() => onChange({ v: c.v })} onClick={() => { if (item?.v === c.v) onChange({ v: "" }); }} />{c.label}</label>)}
          {noteOpen ? <input className="wonwiz-input note" placeholder={`note about ${q.label.replace(/\?$/, "").toLowerCase()}`} value={item?.note || ""} onChange={(e) => onChange({ note: e.target.value })} autoFocus /> : <button type="button" className="qnote" onClick={() => setNoteOpen(true)}>+ note</button>}
        </div>
      )}
    </div>
  );
}
