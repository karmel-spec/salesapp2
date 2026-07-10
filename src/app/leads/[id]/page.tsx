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
  const [compose, setCompose] = useState<"sms" | "email" | null>(null);
  const typeOptions = useLeadTypeOptions();

  const load = useCallback(
    (fresh = false) =>
      api<{ lead: Lead }>(`/api/leads/${encodeURIComponent(id)}${fresh ? "?refresh=1" : ""}`)
        .then((r) => setLead(r.lead))
        .catch((e) => setError(e.message)),
    [id]
  );

  // After a save: force-refresh past every server instance's cache (and
  // Google's own read-after-write lag) so the edit never LOOKS unsaved.
  const loadSoon = useCallback(() => {
    load(true);
    setTimeout(() => load(true), 2500);
  }, [load]);

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
        <RepSelect lead={lead} onFlash={setFlash} onDone={loadSoon} />
        <SubRepSelect lead={lead} onFlash={setFlash} onDone={loadSoon} />
        <span className="spacer" />
        <button className="btn" onClick={askArnold} disabled={asking}>
          {asking ? "Asking Arnold…" : "Ask Arnold for a draft"}
        </button>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", margin: "10px 0 16px" }}>
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
        {lead.phoneDialable && <CallButton leadId={lead.id} onFlash={setFlash} onDone={loadSoon} />}
        <SnoozeButton leadId={lead.id} onFlash={setFlash} onDone={loadSoon} />
        <AdjacentLeadButton currentId={lead.id} dir={-1} />
        <AdjacentLeadButton currentId={lead.id} dir={1} />
      </div>

      {flash && <div className="banner info">{flash}</div>}
      {compose && (
        <ComposePanel
          lead={lead}
          channel={compose}
          onFlash={setFlash}
          onDone={() => { setCompose(null); loadSoon(); }}
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
          ⏰ {lead.daysSinceContact} days since last contact — Arnold joins as sub-rep under the
          {lead.staleRule === "new-10d" ? " 10-day new-lead" : " 30-day"}
          rule ({lead.effectiveRep} keeps the lead). Run the stale sweep from the Dashboard to write it to the sheet.
        </div>
      )}

      <div className="two-col">
        <div>
          <div className="card" style={{ marginBottom: 18 }}>
            <div style={{ display: "flex", alignItems: "baseline" }}>
              <h2>Details</h2>
              <span className="spacer" style={{ flex: 1 }} />
              <span className="muted" style={{ fontSize: 12 }}>click any value to edit</span>
            </div>
            <dl className="kv">
              <dt>Headline</dt><dd><InlineText lead={lead} field="headline" value={lead.headline} onFlash={setFlash} onDone={loadSoon} /></dd>
              <dt>Status</dt><dd><InlineStatus lead={lead} onFlash={setFlash} onDone={loadSoon} /></dd>
              <dt>Rep (sheet)</dt><dd><InlineSelect lead={lead} field="rep" value={lead.repRaw} options={[...REPS]} emptyLabel="— unassigned (defaults to Brigham)" onFlash={setFlash} onDone={loadSoon} /></dd>
              <dt>Sub-rep</dt><dd><InlineSelect lead={lead} field="subRep" value={lead.subRep} options={[...REPS]} emptyLabel="— none (add a helper, e.g. Arnold)" onFlash={setFlash} onDone={loadSoon} /></dd>
              <dt>Opened by</dt><dd><InlineSelect lead={lead} field="openedBy" value={lead.openedBy} options={[...REPS]} emptyLabel="— not recorded" onFlash={setFlash} onDone={loadSoon} /></dd>
              {(lead.statusBucket === "won" || lead.closedBy) && (
                <><dt>Closed by</dt><dd><InlineSelect lead={lead} field="closedBy" value={lead.closedBy} options={[...REPS]} emptyLabel="— who closed the sale?" onFlash={setFlash} onDone={loadSoon} /></dd></>
              )}
              <dt>Phone</dt><dd><InlineText lead={lead} field="phone" value={lead.phone} hint={lead.phoneDialable ? ` → ${lead.phoneDialable}` : ""} onFlash={setFlash} onDone={loadSoon} /></dd>
              <dt>Email</dt><dd><InlineText lead={lead} field="email" value={lead.email} onFlash={setFlash} onDone={loadSoon} /></dd>
              <dt>Social handle</dt><dd><InlineText lead={lead} field="social" value={lead.social} onFlash={setFlash} onDone={loadSoon} /></dd>
              <dt>Type of lead</dt><dd><InlineSelect lead={lead} field="leadType" value={lead.leadType} options={typeOptions} addNew onFlash={setFlash} onDone={loadSoon} /></dd>
              <dt>Piano</dt><dd><InlineText lead={lead} field="pianoType" value={lead.pianoType} onFlash={setFlash} onDone={loadSoon} /></dd>
              <dt>Source of business</dt><dd><InlineSelect lead={lead} field="source" value={lead.source} options={LEAD_SOURCES} onFlash={setFlash} onDone={loadSoon} /></dd>
              <dt>Inquiry method</dt><dd><InlineSelect lead={lead} field="inquiryMethod" value={lead.inquiryMethod} options={INQUIRY_METHODS} onFlash={setFlash} onDone={loadSoon} /></dd>
              <dt>Hot Lead?</dt><dd><InlineSelect lead={lead} field="score" value={lead.score} options={["10", "9", "8", "7", "6", "5", "4", "3", "2", "1"]} emptyLabel="— 10 hot, 1 cold" onFlash={setFlash} onDone={loadSoon} /></dd>
              <dt>$ Value</dt><dd><InlineText lead={lead} field="value" value={lead.value} onFlash={setFlash} onDone={loadSoon} /></dd>
              <dt>Date added</dt><dd>{lead.dateAdded || "—"}</dd>
              <dt>Last contact</dt><dd>{lead.lastContact || "—"} <span className="muted">({fmtDays(lead)})</span></dd>
              <dt>Notes</dt><dd><InlineText lead={lead} field="notes" value={lead.notes} textarea onFlash={setFlash} onDone={loadSoon} /></dd>
            </dl>
          </div>

          <div className="card">
            <h2>Activity</h2>
            <form onSubmit={logActivity} style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
              <select value={noteKind} onChange={(e) => setNoteKind(e.target.value)}>
                <option value="note">Note</option>
                <option value="call">Call</option>
                <option value="sms_out">Text (manual)</option>
                <option value="email_out">Email (manual)</option>
                <option value="followup">Next follow-up instructions</option>
              </select>
              <input style={{ flex: 1 }} placeholder="Log a note, call, or touch…" value={note} onChange={(e) => setNote(e.target.value)} />
              <button className="btn small" disabled={savingNote || !note.trim()}>Log</button>
            </form>
            <ul className="timeline">
              {[...lead.timeline].reverse().map((ev, i) => (
                <TimelineEntry
                  key={`${ev.at}-${i}`}
                  leadId={lead.id}
                  ev={ev}
                  index={lead.timeline.length - 1 - i}
                  onFlash={setFlash}
                  onDone={loadSoon}
                />
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

      <div style={{ marginTop: 18, display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <AdjacentLeadButton currentId={lead.id} dir={-1} />
        <AdjacentLeadButton currentId={lead.id} dir={1} />
      </div>
    </>
  );
}

/**
 * Jump to the next/previous open (new/active) lead in the working list's
 * order, so a rep can grind through the pipeline (or step back one to
 * double-check something) without bouncing back to Leads.
 */
function AdjacentLeadButton({ currentId, dir }: { currentId: string; dir: 1 | -1 }) {
  const [target, setTarget] = useState<{ id: string; name: string } | null | undefined>(undefined);

  useEffect(() => {
    import("@/lib/client").then(({ fetchLeads }) =>
      fetchLeads().then((r) => {
        const open = r.leads.filter((l) => l.statusBucket === "new" || l.statusBucket === "active");
        const i = open.findIndex((l) => l.id === currentId);
        // Adjacent open lead in the chosen direction (wraps around); if the
        // current lead isn't open (won/lost/etc.), start from the list edge.
        const candidates =
          i >= 0
            ? dir === 1
              ? [...open.slice(i + 1), ...open.slice(0, i)]
              : [...open.slice(0, i).reverse(), ...open.slice(i + 1).reverse()]
            : dir === 1
              ? open
              : [...open].reverse();
        const n = candidates.find((l) => l.id !== currentId);
        setTarget(n ? { id: n.id, name: n.name } : null);
      }).catch(() => setTarget(null))
    );
  }, [currentId, dir]);

  const label = dir === 1 ? "Next lead" : "Last lead";
  if (target === undefined) return <button className="btn ghost" disabled>{dir === 1 ? `${label} ›` : `‹ ${label}`}</button>;
  if (target === null) return null;
  const first = target.name.split(" ")[0];
  return (
    <Link href={`/leads/${encodeURIComponent(target.id)}`} className="btn ghost" title={`Jump to ${target.name}`}>
      {dir === 1 ? `${label}: ${first} ›` : `‹ ${label}: ${first}`}
    </Link>
  );
}

/** One activity entry — click ✎ to edit past notes (audit-trailed). */
function TimelineEntry({
  leadId, ev, index, onFlash, onDone,
}: {
  leadId: string;
  ev: Lead["timeline"][number];
  index: number;
  onFlash: (s: string) => void;
  onDone: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    if (text.trim() === ev.text.trim()) { setEditing(false); return; }
    setBusy(true);
    try {
      await api(`/api/leads/${encodeURIComponent(leadId)}/timeline`, {
        method: "PATCH",
        body: JSON.stringify({ index, text, who: getWho() }),
      });
      onFlash("✓ Activity entry updated");
      setEditing(false);
      onDone();
    } catch (e) {
      onFlash(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li>
      <div className="meta">
        {new Date(ev.at).toLocaleString()} · {ev.who} · {ev.kind}
        {ev.editedBy && <span title={ev.editedAt ? new Date(ev.editedAt).toLocaleString() : undefined}> · ✎ edited by {ev.editedBy}</span>}
        {!editing && (
          <button
            className="btn ghost small"
            style={{ marginLeft: 8, padding: "1px 7px", fontSize: 11, minHeight: 0 }}
            title="Edit this entry"
            onClick={() => { setText(ev.text); setEditing(true); }}
          >
            ✎
          </button>
        )}
      </div>
      {editing ? (
        <div style={{ marginTop: 4 }}>
          <textarea
            rows={3}
            style={{ width: "100%" }}
            value={text}
            autoFocus
            disabled={busy}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape") setEditing(false); }}
          />
          <div style={{ marginTop: 6, display: "flex", gap: 8 }}>
            <button className="btn small" onClick={save} disabled={busy || !text.trim()}>
              {busy ? "Saving…" : "Save"}
            </button>
            <button className="btn ghost small" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <div className="body"><Linkify text={ev.text} /></div>
      )}
    </li>
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
          ? `Reassigned to ${rep}. Heads up: this lead is still ${lead.daysSinceContact}d stale — the next sweep adds Arnold as sub-rep unless contact is logged.`
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

/**
 * Assistant rep — works the lead WITH the primary owner (Brigham keeps the
 * lead, Arnold handles delegated follow-up). The stale sweep never steals a
 * lead whose sub-rep is already Arnold.
 */
function SubRepSelect({ lead, onFlash, onDone }: { lead: Lead; onFlash: (s: string) => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false);

  async function assign(subRep: string) {
    if (subRep === lead.subRep) return;
    setBusy(true);
    try {
      await api(`/api/leads/${encodeURIComponent(lead.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ fields: { subRep }, who: getWho() }),
      });
      onFlash(subRep ? `${subRep} added as sub-rep — ${lead.effectiveRep || "the primary"} keeps the lead.` : "Sub-rep removed.");
      onDone();
    } catch (e) {
      onFlash(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <select
      aria-label="Sub-rep (assistant)"
      value={lead.subRep}
      disabled={busy}
      onChange={(e) => assign(e.target.value)}
      style={{ padding: "3px 8px", fontSize: 12.5, borderRadius: 99, color: lead.subRep ? undefined : "#877f7a" }}
      title="Add a second rep who works this lead with the owner"
    >
      <option value="">{lead.subRep ? "— remove sub-rep" : "+ sub-rep"}</option>
      {REPS.filter((r) => r !== lead.effectiveRep).map((r) => (
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
  const [coaching, setCoaching] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [flash, setFlash] = useState("");

  async function act(action: "approve_send" | "dismiss" | "train") {
    setBusy(true);
    setErr("");
    try {
      const r = await api<{ detail?: string; status: string }>(`/api/leads/${encodeURIComponent(leadId)}/drafts`, {
        method: "POST",
        body: JSON.stringify({
          createdAt: draft.createdAt, channel: draft.channel, action, body, subject,
          feedback: action === "train" ? feedback.trim() : undefined, who: getWho(),
        }),
      });
      if (action === "train") {
        setCoaching(false);
        setFeedback("");
        setFlash(r.detail || "Coaching sent.");
      } else {
        onDone();
      }
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
      {flash && <div className="banner good">✓ {flash}</div>}
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
        <button className="btn ghost small" onClick={() => setCoaching((v) => !v)} disabled={busy}>🎓 Train Arnold</button>
      </div>
      {coaching && (
        <div style={{ marginTop: 10, padding: 12, background: "#f7f2ea", borderRadius: 8 }}>
          <label className="field">How could this response be better? Arnold records the lesson and rewrites the draft.</label>
          <textarea
            rows={3}
            placeholder="e.g. Too formal for a text — match how the customer writes, and offer a specific visit time…"
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            autoFocus
          />
          <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
            <button className="btn small" onClick={() => act("train")} disabled={busy || !feedback.trim()}>
              {busy ? "Sending…" : "Send coaching"}
            </button>
            <button className="btn ghost small" onClick={() => { setCoaching(false); setFeedback(""); }}>Cancel</button>
          </div>
        </div>
      )}
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

/** Distinct lead types in real use (2+ leads) for the inline dropdown. */
function useLeadTypeOptions(): string[] {
  const [options, setOptions] = useState<string[]>(DEFAULT_LEAD_TYPES);
  useEffect(() => {
    import("@/lib/client").then(({ fetchLeads }) =>
      fetchLeads().then((r) => {
        const counts = new Map<string, { label: string; n: number }>();
        for (const l of r.leads) {
          const v = (l.leadType || "").trim();
          if (!v || v.length > 40) continue;
          const k = v.toLowerCase();
          const cur = counts.get(k);
          counts.set(k, { label: cur?.label || v, n: (cur?.n || 0) + 1 });
        }
        const seen = new Set(DEFAULT_LEAD_TYPES.map((x) => x.toLowerCase()));
        const extra = [...counts.values()]
          .filter((v) => v.n >= 2 && !seen.has(v.label.toLowerCase()))
          .map((v) => v.label)
          .sort();
        if (extra.length) setOptions([...DEFAULT_LEAD_TYPES, ...extra]);
      }).catch(() => {})
    );
  }, []);
  return options;
}

/** Save one or more fields of the lead to the sheet. */
async function patchField(leadId: string, field: string, value: string): Promise<void> {
  await patchFields(leadId, { [field]: value });
}
async function patchFields(leadId: string, fields: Record<string, string>): Promise<void> {
  await api(`/api/leads/${encodeURIComponent(leadId)}`, {
    method: "PATCH",
    body: JSON.stringify({ fields, who: getWho() }),
  });
}

function InlineText({
  lead, field, value, hint, textarea, onFlash, onDone,
}: {
  lead: Lead; field: string; value: string; hint?: string; textarea?: boolean;
  onFlash: (s: string) => void; onDone: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    if (val.trim() === value.trim()) { setEditing(false); return; }
    setBusy(true);
    try {
      await patchField(lead.id, field, val);
      onFlash(`✓ Saved ${field} to the Leads Log`);
      setEditing(false);
      onDone();
    } catch (e) {
      onFlash(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!editing) {
    return (
      <span className="inline-edit" title="Click to edit" onClick={() => { setVal(value); setEditing(true); }}>
        {value ? (field === "notes" ? <Linkify text={value} /> : value) : <span className="muted">— click to add</span>}
        {hint && <span className="muted">{hint}</span>}
      </span>
    );
  }
  if (textarea) {
    return (
      <span style={{ display: "block" }}>
        <textarea
          rows={4}
          style={{ width: "100%" }}
          value={val}
          autoFocus
          disabled={busy}
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Escape") setEditing(false); }}
          onBlur={save}
        />
        <span className="muted" style={{ fontSize: 11.5 }}>saves when you click away · Esc to cancel</span>
      </span>
    );
  }
  return (
    <input
      style={{ width: "100%" }}
      value={val}
      autoFocus
      disabled={busy}
      onChange={(e) => setVal(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") save();
        if (e.key === "Escape") setEditing(false);
      }}
      onBlur={save}
    />
  );
}

function InlineSelect({
  lead, field, value, options, emptyLabel, addNew, onFlash, onDone,
}: {
  lead: Lead; field: string; value: string; options: string[]; emptyLabel?: string; addNew?: boolean;
  onFlash: (s: string) => void; onDone: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newVal, setNewVal] = useState("");
  const [busy, setBusy] = useState(false);

  async function save(v: string) {
    if (v === value) { setEditing(false); setAdding(false); return; }
    setBusy(true);
    try {
      await patchField(lead.id, field, v);
      onFlash(`✓ Saved ${field} to the Leads Log`);
      setEditing(false);
      setAdding(false);
      onDone();
    } catch (e) {
      onFlash(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!editing) {
    return (
      <span className="inline-edit" title="Click to edit" onClick={() => setEditing(true)}>
        {value || <span className="muted">{emptyLabel || "— click to set"}</span>}
      </span>
    );
  }
  if (adding) {
    return (
      <input
        style={{ width: "100%" }}
        placeholder={`New ${field}…`}
        value={newVal}
        autoFocus
        disabled={busy}
        onChange={(e) => setNewVal(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && newVal.trim()) save(newVal.trim());
          if (e.key === "Escape") { setAdding(false); setEditing(false); }
        }}
        onBlur={() => (newVal.trim() ? save(newVal.trim()) : (setAdding(false), setEditing(false)))}
      />
    );
  }
  return (
    <select
      style={{ width: "100%" }}
      value={options.includes(value) ? value : value ? "__current__" : ""}
      autoFocus
      disabled={busy}
      onChange={(e) => {
        const v = e.target.value;
        if (v === "__new__") setAdding(true);
        else if (v !== "__current__") save(v);
      }}
      onBlur={() => setEditing(false)}
      onKeyDown={(e) => { if (e.key === "Escape") setEditing(false); }}
    >
      <option value="">{emptyLabel || "— not set"}</option>
      {value && !options.includes(value) && <option value="__current__">Keep current: {value.slice(0, 40)}</option>}
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
      {addNew && <option value="__new__">＋ Add a new one…</option>}
    </select>
  );
}

const INLINE_STATUS_CHOICES = ["New", "Active", "Won", "LOST", "Unqualified", "Snoozed", "Closed"];

function InlineStatus({ lead, onFlash, onDone }: { lead: Lead; onFlash: (s: string) => void; onDone: () => void }) {
  const [editing, setEditing] = useState(false);
  const [choice, setChoice] = useState("");
  const [lostWhy, setLostWhy] = useState("");
  const [newLostWhy, setNewLostWhy] = useState("");
  const [lostOptions, setLostOptions] = useState<string[]>(DEFAULT_LOST_REASONS);

  // Grow the reason list with reasons already written in the sheet.
  useEffect(() => {
    if (choice !== "LOST") return;
    import("@/lib/client").then(({ fetchLeads }) =>
      fetchLeads().then((r) => {
        const seen = new Set(DEFAULT_LOST_REASONS.map((x) => x.toLowerCase()));
        const extra: string[] = [];
        for (const l of r.leads) {
          const m = l.status.trim().match(/^lost\??\s*[-–:]\s*(.+)$/i);
          const reason = m?.[1]?.trim();
          if (reason && reason.length <= 40 && !seen.has(reason.toLowerCase())) {
            seen.add(reason.toLowerCase());
            extra.push(reason);
          }
        }
        if (extra.length) setLostOptions([...DEFAULT_LOST_REASONS, ...extra.sort()]);
      }).catch(() => {})
    );
  }, [choice]);
  const [snoozeDate, setSnoozeDate] = useState("");
  const [closedBy, setClosedBy] = useState("");
  const [busy, setBusy] = useState(false);

  async function save(status: string, extra: Record<string, string> = {}) {
    setBusy(true);
    try {
      await patchFields(lead.id, { status, ...extra });
      onFlash(`✓ Status set to "${status}"`);
      setEditing(false);
      setChoice("");
      onDone();
    } catch (e) {
      onFlash(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!editing) {
    return (
      <span className="inline-edit" title="Click to edit" onClick={() => setEditing(true)}>
        {lead.status || <span className="muted">(blank = New)</span>}
      </span>
    );
  }

  if (choice === "LOST") {
    const reason = lostWhy === "__new__" ? newLostWhy.trim() : lostWhy;
    return (
      <span style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ fontSize: 13 }}>💔 Why was it lost? (required — picking a reason saves)</span>
        <select
          value={lostWhy}
          autoFocus
          disabled={busy}
          onChange={(e) => {
            const v = e.target.value;
            setLostWhy(v);
            if (v && v !== "__new__") save(`LOST - ${v}`); // picking a reason IS the save
          }}
          style={{ flex: 1, minWidth: 150 }}
        >
          <option value="">— pick a reason</option>
          {lostOptions.map((r) => <option key={r} value={r}>{r}</option>)}
          <option value="__new__">＋ Add a new reason…</option>
        </select>
        {lostWhy === "__new__" && (
          <>
            <input
              style={{ flex: 1, minWidth: 130 }}
              placeholder="New reason — Enter saves"
              value={newLostWhy}
              onChange={(e) => setNewLostWhy(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && reason) save(`LOST - ${reason}`); }}
              autoFocus
            />
            <button className="btn small" disabled={busy || !reason} onClick={() => save(`LOST - ${reason}`)}>{busy ? "Saving…" : "✓ Lost"}</button>
          </>
        )}
        <button className="btn ghost small" onClick={() => { setChoice(""); setEditing(false); }}>✕</button>
      </span>
    );
  }
  if (choice === "Won") {
    return (
      <span style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        {closedBy === "" ? (
          <>
            <span style={{ fontSize: 13 }}>🏆 Did Brigham close this sale?</span>
            <button className="btn small" disabled={busy} onClick={() => save("Won", { closedBy: "Brigham" })}>
              {busy ? "Saving…" : "✓ Yes — Won"}
            </button>
            <button className="btn ghost small" disabled={busy} onClick={() => setClosedBy("__pick__")}>
              Another rep…
            </button>
          </>
        ) : (
          <>
            <span style={{ fontSize: 13 }}>🏆 Sale closed by:</span>
            <select
              value={closedBy === "__pick__" ? "" : closedBy}
              autoFocus
              disabled={busy}
              onChange={(e) => {
                const v = e.target.value;
                setClosedBy(v || "__pick__");
                if (v) save("Won", { closedBy: v }); // picking the closer IS the save
              }}
            >
              <option value="">— pick the closer (saves)</option>
              {REPS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </>
        )}
        <button className="btn ghost small" onClick={() => { setChoice(""); setClosedBy(""); setEditing(false); }}>✕</button>
      </span>
    );
  }
  if (choice === "Snoozed") {
    return (
      <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <input type="date" value={snoozeDate} autoFocus disabled={busy} onChange={(e) => setSnoozeDate(e.target.value)} />
        <button
          className="btn small"
          disabled={busy || !snoozeDate}
          onClick={() => {
            const [y, m, d] = snoozeDate.split("-").map(Number);
            save(`Snoozed until ${m}/${d}/${y}`);
          }}
        >
          ✓
        </button>
        <button className="btn ghost small" onClick={() => { setChoice(""); setEditing(false); }}>✕</button>
      </span>
    );
  }
  return (
    <select
      style={{ width: "100%" }}
      value=""
      autoFocus
      disabled={busy}
      onChange={(e) => {
        const v = e.target.value;
        if (v === "LOST" || v === "Snoozed" || v === "Won") setChoice(v);
        else if (v) save(v);
      }}
      onKeyDown={(e) => { if (e.key === "Escape") setEditing(false); }}
    >
      <option value="">{`Keep current: "${lead.status || "(blank = New)"}"`}</option>
      {INLINE_STATUS_CHOICES.map((s) => (
        <option key={s} value={s}>
          {s === "LOST" ? "Lost — requires a reason" : s === "Snoozed" ? "Snoozed — requires a wake-up date" : s}
        </option>
      ))}
    </select>
  );
}
