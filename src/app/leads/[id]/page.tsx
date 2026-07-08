"use client";

import { useCallback, useEffect, useState, use } from "react";
import Link from "next/link";
import type { Lead, DraftMessage } from "@/lib/leads";
import { api, getWho } from "@/lib/client";
import { RepBadge, StaleBadge, StatusBadge, fmtDays } from "@/components/ui";

export default function LeadDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [lead, setLead] = useState<Lead | null>(null);
  const [error, setError] = useState("");
  const [flash, setFlash] = useState("");
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState("");
  const [noteKind, setNoteKind] = useState("note");
  const [savingNote, setSavingNote] = useState(false);
  const [editing, setEditing] = useState(false);

  const load = useCallback(
    () =>
      api<{ lead: Lead }>(`/api/leads/${encodeURIComponent(id)}`)
        .then((r) => setLead(r.lead))
        .catch((e) => setError(e.message)),
    [id]
  );

  useEffect(() => {
    load();
  }, [load]);

  async function askArnold() {
    setAsking(true);
    setFlash("");
    try {
      const r = await api<{ mode: string; detail: string }>("/api/arnold/ask", {
        method: "POST",
        body: JSON.stringify({ leadId: id }),
      });
      setFlash(r.mode === "webhook" ? r.detail : `Arnold drafted suggestions — ${r.detail}`);
      await load();
    } catch (e) {
      setFlash(e instanceof Error ? e.message : String(e));
    } finally {
      setAsking(false);
    }
  }

  async function logActivity(e: React.FormEvent) {
    e.preventDefault();
    if (!note.trim()) return;
    setSavingNote(true);
    try {
      await api(`/api/leads/${encodeURIComponent(id)}/timeline`, {
        method: "POST",
        body: JSON.stringify({ kind: noteKind, text: note, who: getWho() }),
      });
      setNote("");
      await load();
    } catch (err) {
      setFlash(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingNote(false);
    }
  }

  if (error) return <div className="banner bad">⚠ {error}</div>;
  if (!lead) return <div className="spin">Loading lead…</div>;

  const pending = lead.drafts.filter((d) => d.status === "pending");

  return (
    <>
      <div className="page-head">
        <Link href="/leads" className="muted">← Leads</Link>
        <h1>{lead.name}</h1>
        <StatusBadge lead={lead} />
        <StaleBadge lead={lead} />
        <RepBadge rep={lead.effectiveRep} />
        <span className="spacer" />
        {lead.phoneDialable && <CallButton leadId={lead.id} onFlash={setFlash} onDone={load} />}
        <button className="btn" onClick={askArnold} disabled={asking}>
          {asking ? "Asking Arnold…" : "🤖 Ask Arnold for a draft"}
        </button>
      </div>

      {flash && <div className="banner info">🤖 {flash}</div>}
      {lead.isStale && lead.rep !== "Arnold" && (
        <div className="banner warn">
          ⏰ {lead.daysSinceContact} days since last contact — this lead now belongs to Arnold by the 30-day
          rule. Run the stale sweep from the Dashboard to write it back to the sheet.
        </div>
      )}

      <div className="two-col">
        <div>
          <div className="card" style={{ marginBottom: 18 }}>
            <div style={{ display: "flex", alignItems: "baseline" }}>
              <h2>Details</h2>
              <span className="spacer" style={{ flex: 1 }} />
              <button className="btn ghost small" onClick={() => setEditing((v) => !v)}>
                {editing ? "Close" : "✎ Edit"}
              </button>
            </div>
            {editing ? (
              <EditForm lead={lead} onSaved={() => { setEditing(false); load(); }} />
            ) : (
              <dl className="kv">
                <dt>Headline</dt><dd>{lead.headline || "—"}</dd>
                <dt>Status (raw)</dt><dd>{lead.status || "—"}</dd>
                <dt>Rep (sheet)</dt><dd>{lead.repRaw || "— (defaults to Brigham)"}</dd>
                <dt>Phone</dt><dd>{lead.phone || "—"}{lead.phoneDialable && <span className="muted"> → {lead.phoneDialable}</span>}</dd>
                <dt>Email</dt><dd>{lead.email || "—"}</dd>
                <dt>Type of lead</dt><dd>{lead.leadType || "—"}</dd>
                <dt>Piano</dt><dd>{lead.pianoType || "—"}</dd>
                <dt>Source</dt><dd>{lead.source || "—"}</dd>
                <dt>Inquiry method</dt><dd>{lead.inquiryMethod || "—"}</dd>
                <dt>$ Value</dt><dd>{lead.value || "—"}</dd>
                <dt>Date added</dt><dd>{lead.dateAdded || "—"}</dd>
                <dt>Last contact</dt><dd>{lead.lastContact || "—"} <span className="muted">({fmtDays(lead)})</span></dd>
                <dt>Notes</dt><dd>{lead.notes || "—"}</dd>
              </dl>
            )}
          </div>

          <div className="card">
            <h2>Activity</h2>
            <form onSubmit={logActivity} style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
              <select value={noteKind} onChange={(e) => setNoteKind(e.target.value)}>
                <option value="note">Note</option>
                <option value="call">Call</option>
                <option value="sms_out">Text (manual)</option>
                <option value="email_out">Email (manual)</option>
              </select>
              <input style={{ flex: 1 }} placeholder="Log a note, call, or touch…" value={note} onChange={(e) => setNote(e.target.value)} />
              <button className="btn small" disabled={savingNote || !note.trim()}>Log</button>
            </form>
            <ul className="timeline">
              {[...lead.timeline].reverse().map((ev, i) => (
                <li key={i}>
                  <div className="meta">
                    {new Date(ev.at).toLocaleString()} · {ev.who} · {ev.kind}
                  </div>
                  <div className="body">{ev.text}</div>
                </li>
              ))}
              {lead.activityTimeline && (
                <li>
                  <div className="meta">From the sheet&apos;s Activity Timeline column</div>
                  <div className="body">{lead.activityTimeline}</div>
                </li>
              )}
              {!lead.timeline.length && !lead.activityTimeline && <li className="muted">No activity yet.</li>}
            </ul>
          </div>
        </div>

        <div>
          <div className="card">
            <h2>Arnold&apos;s drafts</h2>
            {pending.length === 0 && (
              <div className="muted" style={{ marginBottom: 8 }}>
                No pending drafts. Ask Arnold to suggest the next text + email for this lead.
              </div>
            )}
            {pending.map((d) => (
              <DraftCard key={`${d.channel}-${d.createdAt}`} leadId={lead.id} draft={d} lead={lead} onDone={load} />
            ))}
            {lead.drafts.some((d) => d.status !== "pending") && (
              <>
                <h2 style={{ marginTop: 18 }}>History</h2>
                {lead.drafts
                  .filter((d) => d.status !== "pending")
                  .map((d, i) => (
                    <div key={i} className="muted" style={{ padding: "6px 0", borderBottom: "1px solid #f0ece6" }}>
                      {d.status === "sent" ? "✅" : "✖"} {d.channel.toUpperCase()} {d.status}
                      {d.sentAt ? ` · ${new Date(d.sentAt).toLocaleString()}` : ""} — “{d.body.slice(0, 90)}…”
                    </div>
                  ))}
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function CallButton({ leadId, onFlash, onDone }: { leadId: string; onFlash: (s: string) => void; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [repPhone, setRepPhone] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setRepPhone(localStorage.getItem("blp_rep_phone") || "");
  }, []);

  async function call() {
    setBusy(true);
    try {
      localStorage.setItem("blp_rep_phone", repPhone);
      const r = await api<{ detail: string }>(`/api/leads/${encodeURIComponent(leadId)}/call`, {
        method: "POST",
        body: JSON.stringify({ repPhone, who: getWho() }),
      });
      onFlash(`📞 ${r.detail}`);
      setOpen(false);
      onDone();
    } catch (e) {
      onFlash(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button className="btn ghost" onClick={() => setOpen(true)}>📞 Call</button>
    );
  }
  return (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      <input
        style={{ width: 170 }}
        placeholder="Your cell (rings first)"
        value={repPhone}
        onChange={(e) => setRepPhone(e.target.value)}
        autoFocus
      />
      <button className="btn small" onClick={call} disabled={busy || repPhone.replace(/\D/g, "").length < 10}>
        {busy ? "Dialing…" : "Start call"}
      </button>
      <button className="btn ghost small" onClick={() => setOpen(false)}>✕</button>
    </span>
  );
}

function DraftCard({ leadId, draft, lead, onDone }: { leadId: string; draft: DraftMessage; lead: Lead; onDone: () => void }) {
  const [body, setBody] = useState(draft.body);
  const [subject, setSubject] = useState(draft.subject || "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function act(action: "approve_send" | "dismiss") {
    setBusy(true);
    setErr("");
    try {
      await api(`/api/leads/${encodeURIComponent(leadId)}/drafts`, {
        method: "POST",
        body: JSON.stringify({ createdAt: draft.createdAt, channel: draft.channel, action, body, subject, who: getWho() }),
      });
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const target = draft.channel === "sms" ? lead.phoneDialable || "⚠ no phone found" : lead.emailClean || "⚠ no email found";

  return (
    <div className={`draft ${draft.channel}`}>
      <div className="head">
        <strong>{draft.channel === "sms" ? "📱 Text" : "✉️ Email"}</strong>
        <span>→ {target}</span>
        <span style={{ marginLeft: "auto" }}>by {draft.createdBy === "arnold-api" ? "Arnold (AI)" : draft.createdBy}</span>
      </div>
      {err && <div className="banner bad">⚠ {err}</div>}
      {draft.note && <div className="muted" style={{ marginBottom: 8 }}>💡 {draft.note}</div>}
      {draft.channel === "email" && (
        <input style={{ width: "100%", marginBottom: 8 }} value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" />
      )}
      <textarea rows={draft.channel === "sms" ? 3 : 8} value={body} onChange={(e) => setBody(e.target.value)} />
      <div className="actions">
        <button className="btn small" onClick={() => act("approve_send")} disabled={busy}>
          {busy ? "Working…" : draft.channel === "sms" ? "Approve & send text" : "Approve & send from info@"}
        </button>
        <button className="btn ghost small" onClick={() => act("dismiss")} disabled={busy}>Dismiss</button>
      </div>
    </div>
  );
}

function EditForm({ lead, onSaved }: { lead: Lead; onSaved: () => void }) {
  const [f, setF] = useState({
    status: lead.status,
    rep: lead.repRaw,
    headline: lead.headline,
    phone: lead.phone,
    email: lead.email,
    leadType: lead.leadType,
    pianoType: lead.pianoType,
    value: lead.value,
    notes: lead.notes,
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      await api(`/api/leads/${encodeURIComponent(lead.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ fields: f, who: getWho() }),
      });
      onSaved();
    } catch (error) {
      setErr(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save}>
      {err && <div className="banner bad">⚠ {err}</div>}
      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
        {(
          [
            ["status", "Status"], ["rep", "Sales rep"], ["headline", "Headline"], ["phone", "Phone"],
            ["email", "Email"], ["leadType", "Type of lead"], ["pianoType", "Piano"], ["value", "$ Value"],
          ] as const
        ).map(([key, label]) => (
          <div key={key}>
            <label className="field">{label}</label>
            <input style={{ width: "100%" }} value={f[key]} onChange={(e) => setF({ ...f, [key]: e.target.value })} />
          </div>
        ))}
      </div>
      <div style={{ marginTop: 10 }}>
        <label className="field">Notes</label>
        <textarea rows={4} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
      </div>
      <button className="btn" style={{ marginTop: 12 }} disabled={busy}>
        {busy ? "Writing to sheet…" : "Save to Leads Log"}
      </button>
    </form>
  );
}
