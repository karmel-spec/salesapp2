"use client";

import { useCallback, useEffect, useState, use } from "react";
import Link from "next/link";
import type { Lead, DraftMessage } from "@/lib/leads";
import { api, getWho, REPS, LEAD_SOURCES, INQUIRY_METHODS } from "@/lib/client";
import { Linkify, StaleBadge, StatusBadge, fmtDays } from "@/components/ui";

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
  const [compose, setCompose] = useState<"sms" | "email" | null>(null);

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
        <RepSelect lead={lead} onFlash={setFlash} onDone={load} />
        <span className="spacer" />
        <button className="btn" onClick={askArnold} disabled={asking}>
          {asking ? "Asking Arnold…" : "Ask Arnold for a draft"}
        </button>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", margin: "10px 0 16px" }}>
        <SnoozeButton leadId={lead.id} onFlash={setFlash} onDone={load} />
        {lead.phoneDialable && <CallButton leadId={lead.id} onFlash={setFlash} onDone={load} />}
        {lead.phoneDialable && (
          <button className="btn ghost" onClick={() => setCompose(compose === "sms" ? null : "sms")}>
            💬 Text
          </button>
        )}
        {lead.emailClean && (
          <button className="btn ghost" onClick={() => setCompose(compose === "email" ? null : "email")}>
            ✉️ Email
          </button>
        )}
        <NextLeadButton currentId={lead.id} />
      </div>

      {flash && <div className="banner info">{flash}</div>}
      {compose && (
        <ComposePanel
          lead={lead}
          channel={compose}
          onFlash={setFlash}
          onDone={() => { setCompose(null); load(); }}
          onClose={() => setCompose(null)}
        />
      )}
      {lead.statusBucket === "snoozed" && (
        <div className="banner info">
          💤 Snoozed{lead.snoozeUntil ? ` until ${lead.snoozeUntil}` : ""} — this lead sleeps (no stale rule)
          and wakes to Active automatically when the date arrives.
        </div>
      )}
      {lead.snoozeWoke && (
        <div className="banner warn">
          ⏰ This lead's snooze{lead.snoozeUntil ? ` (until ${lead.snoozeUntil})` : ""} has ended — it's back in
          the active pipeline. The next sweep writes the wake-up to the sheet.
        </div>
      )}
      {lead.isStale && lead.rep !== "Arnold" && (
        <div className="banner warn">
          ⏰ {lead.daysSinceContact} days since last contact — this lead now belongs to Arnold by the
          {lead.staleRule === "new-10d" ? " 10-day new-lead" : " 30-day"}
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
                <dt>Notes</dt><dd>{lead.notes ? <Linkify text={lead.notes} /> : "—"}</dd>
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
                  <div className="body"><Linkify text={ev.text} /></div>
                </li>
              ))}
              {lead.activityTimeline && (
                <li>
                  <div className="meta">From the sheet&apos;s Activity Timeline column</div>
                  <div className="body"><Linkify text={lead.activityTimeline} /></div>
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

      <div style={{ marginTop: 18, display: "flex", justifyContent: "flex-end" }}>
        <NextLeadButton currentId={lead.id} />
      </div>
    </>
  );
}

/**
 * Jump to the next open (new/active) lead in the working list's order,
 * so a rep can grind through the pipeline without bouncing back to Leads.
 */
function NextLeadButton({ currentId }: { currentId: string }) {
  const [next, setNext] = useState<{ id: string; name: string } | null | undefined>(undefined);

  useEffect(() => {
    import("@/lib/client").then(({ fetchLeads }) =>
      fetchLeads().then((r) => {
        const open = r.leads.filter((l) => l.statusBucket === "new" || l.statusBucket === "active");
        const i = open.findIndex((l) => l.id === currentId);
        // Next open lead after this one (wraps to the top); if the current
        // lead isn't open (won/lost/etc.), just start at the first open lead.
        const candidates = i >= 0 ? [...open.slice(i + 1), ...open.slice(0, i)] : open;
        const n = candidates.find((l) => l.id !== currentId);
        setNext(n ? { id: n.id, name: n.name } : null);
      }).catch(() => setNext(null))
    );
  }, [currentId]);

  if (next === undefined) return <button className="btn ghost" disabled>Next lead ›</button>;
  if (next === null) return null;
  return (
    <Link href={`/leads/${encodeURIComponent(next.id)}`} className="btn ghost" title={`Jump to ${next.name}`}>
      Next lead: {next.name.split(" ")[0]} ›
    </Link>
  );
}

function RepSelect({ lead, onFlash, onDone }: { lead: Lead; onFlash: (s: string) => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const options = Array.from(new Set([...REPS, lead.effectiveRep].filter(Boolean)));

  async function reassign(rep: string) {
    if (rep === lead.effectiveRep) return;
    setBusy(true);
    try {
      await api(`/api/leads/${encodeURIComponent(lead.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ fields: { rep }, who: getWho() }),
      });
      onFlash(
        lead.isStale && rep !== "Arnold"
          ? `Reassigned to ${rep}. Heads up: this lead is still ${lead.daysSinceContact}d stale — the next stale sweep hands it back to Arnold unless contact is logged.`
          : `Reassigned to ${rep}.`
      );
      onDone();
    } catch (e) {
      onFlash(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <select
      aria-label="Assigned rep"
      value={lead.effectiveRep}
      disabled={busy}
      onChange={(e) => reassign(e.target.value)}
      style={{ padding: "3px 8px", fontSize: 12.5, fontWeight: 600, borderRadius: 99 }}
      title="Reassign this lead"
    >
      {options.map((r) => (
        <option key={r} value={r}>{r}</option>
      ))}
    </select>
  );
}

function SnoozeButton({ leadId, onFlash, onDone }: { leadId: string; onFlash: (s: string) => void; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [until, setUntil] = useState("");
  const [busy, setBusy] = useState(false);

  async function snooze() {
    setBusy(true);
    try {
      const [y, m, d] = until.split("-").map(Number);
      const pretty = `${m}/${d}/${y}`;
      await api(`/api/leads/${encodeURIComponent(leadId)}`, {
        method: "PATCH",
        body: JSON.stringify({ fields: { status: `Snoozed until ${pretty}` }, who: getWho() }),
      });
      await api(`/api/leads/${encodeURIComponent(leadId)}/timeline`, {
        method: "POST",
        body: JSON.stringify({ kind: "note", text: `💤 Snoozed until ${pretty} — will wake to Active automatically.`, who: getWho() }),
      });
      onFlash(`Snoozed until ${pretty}. It will wake to Active on its own.`);
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
      <button className="btn ghost" onClick={() => setOpen(true)}>💤 Snooze</button>
    );
  }
  return (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      <input type="date" value={until} onChange={(e) => setUntil(e.target.value)} autoFocus />
      <button className="btn small" onClick={snooze} disabled={busy || !until}>
        {busy ? "Snoozing…" : "Snooze until"}
      </button>
      <button className="btn ghost small" onClick={() => setOpen(false)}>✕</button>
    </span>
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

function ComposePanel({
  lead,
  channel,
  onFlash,
  onDone,
  onClose,
}: {
  lead: Lead;
  channel: "sms" | "email";
  onFlash: (s: string) => void;
  onDone: () => void;
  onClose: () => void;
}) {
  const [body, setBody] = useState("");
  const [subject, setSubject] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const isEmail = channel === "email";
  const to = isEmail ? lead.emailClean : lead.phoneDialable;

  async function send() {
    setBusy(true);
    setErr("");
    try {
      const r = await api<{ detail: string }>(`/api/leads/${encodeURIComponent(lead.id)}/send`, {
        method: "POST",
        body: JSON.stringify({ channel, body, subject, who: getWho() }),
      });
      onFlash(`✓ ${r.detail}`);
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ marginBottom: 18, borderLeft: "3px solid #2e7d46" }}>
      <div style={{ display: "flex", alignItems: "baseline" }}>
        <h2>{isEmail ? "✉️ Email" : "💬 Text"} {lead.name}</h2>
        <span className="muted" style={{ marginLeft: 10 }}>→ {to}</span>
        <span className="spacer" style={{ flex: 1 }} />
        <button className="btn ghost small" onClick={onClose}>✕</button>
      </div>
      {err && <div className="banner bad">⚠ {err}</div>}
      {isEmail && (
        <input
          style={{ width: "100%", marginBottom: 8 }}
          placeholder="Subject"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          autoFocus
        />
      )}
      <textarea
        rows={isEmail ? 8 : 4}
        placeholder={isEmail ? "Write your email… (markdown links like [Pictures](url) become clean links)" : "Write your text message…"}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        autoFocus={!isEmail}
      />
      <div style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "center" }}>
        <button
          className="btn"
          onClick={send}
          disabled={busy || !body.trim() || (isEmail && !subject.trim())}
        >
          {busy ? "Sending…" : `Send ${isEmail ? "email" : "text"}`}
        </button>
        <span className="muted" style={{ fontSize: 12 }}>
          sends immediately as {getWho() || "you"} — {isEmail ? "from info@brighamlarsonpianos.com" : "from the store number"} — and lands in the lead's activity
        </span>
      </div>
    </div>
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

const DEFAULT_LOST_REASONS = ["KSL", "Piano Gallery", "Too expensive", "Bought elsewhere", "No response"];
const DEFAULT_LEAD_TYPES = ["Sales", "Restoration", "Player Restoration", "Refinishing", "Refurbishing", "QRS", "Trade-in Sales Lead"];

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "keep", label: "" }, // label filled at render with the current raw status
  { value: "New", label: "New — first 7 days, then auto-switches to Active" },
  { value: "Active", label: "Active — being worked" },
  { value: "WON", label: "Won" },
  { value: "LOST", label: "Lost — requires a reason" },
  { value: "Unqualified", label: "Unqualified — not actually a lead (leaves the funnel)" },
  { value: "Snoozed", label: "Snoozed — requires a wake-up date" },
  { value: "Closed", label: "Closed — all efforts completed, no response" },
  { value: "stale-info", label: "Stale — automatic (10d if never contacted, 30d if worked; not selectable)" },
];

function EditForm({ lead, onSaved }: { lead: Lead; onSaved: () => void }) {
  const [f, setF] = useState({
    rep: lead.repRaw,
    headline: lead.headline,
    phone: lead.phone,
    email: lead.email,
    social: lead.social,
    source: lead.source,
    inquiryMethod: lead.inquiryMethod,
    leadType: lead.leadType,
    pianoType: lead.pianoType,
    value: lead.value,
    notes: lead.notes,
  });
  const [statusChoice, setStatusChoice] = useState("keep");
  const [lostWhy, setLostWhy] = useState("");
  const [newLostWhy, setNewLostWhy] = useState("");
  const [lostOptions, setLostOptions] = useState<string[]>(DEFAULT_LOST_REASONS);
  const [snoozeDate, setSnoozeDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [typeOptions, setTypeOptions] = useState<string[]>(DEFAULT_LEAD_TYPES);
  const [newLeadType, setNewLeadType] = useState("");

  // Harvest lead types already used in the sheet (values used more than once)
  // so the dropdown reflects how the team actually categorizes.
  useEffect(() => {
    import("@/lib/client").then(({ fetchLeads }) =>
      fetchLeads().then((r) => {
        const counts = new Map<string, { label: string; n: number }>();
        for (const l of r.leads) {
          const t = (l.leadType || "").trim();
          if (!t || t.length > 40) continue; // skip blanks and note-length junk values
          const k = t.toLowerCase();
          const cur = counts.get(k);
          counts.set(k, { label: cur?.label || t, n: (cur?.n || 0) + 1 });
        }
        const seen = new Set(DEFAULT_LEAD_TYPES.map((x) => x.toLowerCase()));
        const extra = [...counts.values()]
          .filter((v) => v.n >= 2 && !seen.has(v.label.toLowerCase()))
          .map((v) => v.label)
          .sort();
        if (extra.length) setTypeOptions([...DEFAULT_LEAD_TYPES, ...extra]);
      }).catch(() => {})
    );
  }, []);

  // Harvest lost reasons already used in the sheet so the list grows itself.
  useEffect(() => {
    if (statusChoice !== "LOST") return;
    import("@/lib/client").then(({ fetchLeads }) =>
      fetchLeads().then((r) => {
        const seen = new Set(DEFAULT_LOST_REASONS.map((x) => x.toLowerCase()));
        const extra: string[] = [];
        for (const l of r.leads) {
          const m = l.status.trim().match(/^lost\??\s*[-–:]\s*(.+)$/i);
          const reason = m?.[1]?.trim();
          if (reason && !seen.has(reason.toLowerCase())) {
            seen.add(reason.toLowerCase());
            extra.push(reason);
          }
        }
        if (extra.length) setLostOptions([...DEFAULT_LOST_REASONS, ...extra.sort()]);
      }).catch(() => {})
    );
  }, [statusChoice]);

  function composedStatus(): { value?: string; error?: string } {
    switch (statusChoice) {
      case "keep":
      case "stale-info":
        return {};
      case "LOST": {
        const reason = lostWhy === "__new__" ? newLostWhy.trim() : lostWhy;
        if (!reason) return { error: "Pick (or add) the reason this lead was lost." };
        return { value: `LOST - ${reason}` };
      }
      case "Snoozed": {
        if (!snoozeDate) return { error: "Pick the wake-up date for the snooze." };
        const [y, m, d] = snoozeDate.split("-").map(Number);
        return { value: `Snoozed until ${m}/${d}/${y}` };
      }
      default:
        return { value: statusChoice };
    }
  }

  const statusResult = composedStatus();

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (statusResult.error) {
      setErr(statusResult.error);
      return;
    }
    setBusy(true);
    setErr("");
    try {
      const fields: Record<string, string> = { ...f };
      if (fields.leadType === "__new__") {
        if (!newLeadType.trim()) {
          setErr("Type the new lead type (or pick one from the list).");
          setBusy(false);
          return;
        }
        fields.leadType = newLeadType.trim();
      }
      if (statusResult.value) fields.status = statusResult.value;
      await api(`/api/leads/${encodeURIComponent(lead.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ fields, who: getWho() }),
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

      <div style={{ marginBottom: 10 }}>
        <label className="field">Status</label>
        <select
          style={{ width: "100%" }}
          value={statusChoice}
          onChange={(e) => setStatusChoice(e.target.value)}
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value} disabled={o.value === "stale-info"}>
              {o.value === "keep" ? `Keep current: "${lead.status || "(blank = New)"}"` : o.label}
            </option>
          ))}
        </select>
      </div>

      {statusChoice === "LOST" && (
        <div style={{ marginBottom: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
          <select value={lostWhy} onChange={(e) => setLostWhy(e.target.value)} style={{ flex: 1, minWidth: 180 }}>
            <option value="">Lost to / because… (required)</option>
            {lostOptions.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
            <option value="__new__">＋ Add a new reason…</option>
          </select>
          {lostWhy === "__new__" && (
            <input
              style={{ flex: 1, minWidth: 160 }}
              placeholder="New reason (e.g. Facebook Marketplace)"
              value={newLostWhy}
              onChange={(e) => setNewLostWhy(e.target.value)}
              autoFocus
            />
          )}
        </div>
      )}

      {statusChoice === "Snoozed" && (
        <div style={{ marginBottom: 10 }}>
          <label className="field">Wake-up date (required) — lead returns to Active automatically</label>
          <input type="date" value={snoozeDate} onChange={(e) => setSnoozeDate(e.target.value)} />
        </div>
      )}

      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <div>
          <label className="field">Sales rep</label>
          <select
            style={{ width: "100%" }}
            value={f.rep}
            onChange={(e) => setF({ ...f, rep: e.target.value })}
          >
            <option value="">— unassigned (defaults to Brigham)</option>
            {Array.from(new Set([...REPS, f.rep].filter(Boolean))).map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="field">Type of lead</label>
          <select
            style={{ width: "100%" }}
            value={typeOptions.includes(f.leadType) || f.leadType === "" ? f.leadType : "__current__"}
            onChange={(e) => {
              const v = e.target.value;
              if (v === "__new__") { setNewLeadType(""); setF({ ...f, leadType: "__new__" }); }
              else if (v !== "__current__") setF({ ...f, leadType: v });
            }}
          >
            <option value="">— not set</option>
            {f.leadType && !typeOptions.includes(f.leadType) && f.leadType !== "__new__" && (
              <option value="__current__">Keep current: {f.leadType.slice(0, 40)}</option>
            )}
            {typeOptions.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
            <option value="__new__">＋ Add a new type…</option>
          </select>
          {f.leadType === "__new__" && (
            <input
              style={{ width: "100%", marginTop: 6 }}
              placeholder="New lead type (e.g. Rental)"
              value={newLeadType}
              onChange={(e) => setNewLeadType(e.target.value)}
              autoFocus
            />
          )}
        </div>
        <div>
          <label className="field">Source</label>
          <select
            style={{ width: "100%" }}
            value={LEAD_SOURCES.includes(f.source) || f.source === "" ? f.source : "__current__"}
            onChange={(e) => { if (e.target.value !== "__current__") setF({ ...f, source: e.target.value }); }}
          >
            <option value="">— not set</option>
            {f.source && !LEAD_SOURCES.includes(f.source) && (
              <option value="__current__">Keep current: {f.source.slice(0, 40)}</option>
            )}
            {LEAD_SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className="field">Inquiry method</label>
          <select
            style={{ width: "100%" }}
            value={INQUIRY_METHODS.includes(f.inquiryMethod) || f.inquiryMethod === "" ? f.inquiryMethod : "__current__"}
            onChange={(e) => { if (e.target.value !== "__current__") setF({ ...f, inquiryMethod: e.target.value }); }}
          >
            <option value="">— not set</option>
            {f.inquiryMethod && !INQUIRY_METHODS.includes(f.inquiryMethod) && (
              <option value="__current__">Keep current: {f.inquiryMethod.slice(0, 40)}</option>
            )}
            {INQUIRY_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        {(
          [
            ["headline", "Headline"], ["phone", "Phone"],
            ["email", "Email"], ["social", "Social media handle"], ["pianoType", "Piano"], ["value", "$ Value"],
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
      <button className="btn" style={{ marginTop: 12 }} disabled={busy || Boolean(statusResult.error && statusChoice !== "keep")} title={statusResult.error || ""}>
        {busy ? "Writing to sheet…" : "Save to Leads Log"}
      </button>
    </form>
  );
}
