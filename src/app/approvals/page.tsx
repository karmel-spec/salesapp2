"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { Lead } from "@/lib/leads";
import { api, fetchLeads, getWho, REPS } from "@/lib/client";
import { RepBadge, StaleBadge } from "@/components/ui";

/** Approval queue: every pending Arnold draft across all leads. */
export default function ApprovalsPage() {
  const [leads, setLeads] = useState<Lead[] | null>(null);
  const [error, setError] = useState("");
  const [flash, setFlash] = useState<{ kind: "good" | "bad"; text: string } | null>(null);
  const [repFilter, setRepFilter] = useState("all");

  const load = () => fetchLeads(true).then((r) => setLeads(r.leads)).catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);

  const queue = useMemo(() => {
    if (!leads) return [];
    return leads
      .map((lead) => ({ lead, drafts: lead.drafts.filter((d) => d.status === "pending") }))
      .filter((x) => x.drafts.length > 0);
  }, [leads]);

  const repOptions = useMemo(
    () => Array.from(new Set([...REPS, ...queue.map((x) => x.lead.effectiveRep)].filter(Boolean))).sort(),
    [queue]
  );

  // Default the filter to whoever is signed in on this device.
  useEffect(() => {
    const me = getWho();
    if (me !== "app" && repOptions.includes(me)) setRepFilter(me);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repOptions.join(",")]);

  const visibleQueue = useMemo(
    () => (repFilter === "all" ? queue : queue.filter((x) => x.lead.effectiveRep === repFilter)),
    [queue, repFilter]
  );

  async function act(leadId: string, createdAt: string, channel: string, action: "approve_send" | "dismiss" | "train", body: string, subject: string, feedback?: string) {
    setFlash(null);
    try {
      const r = await api<{ detail?: string; status: string }>(`/api/leads/${encodeURIComponent(leadId)}/drafts`, {
        method: "POST",
        body: JSON.stringify({ createdAt, channel, action, body, subject, feedback, who: getWho() }),
      });
      setFlash({ kind: "good", text: r.detail || `Draft ${r.status}` });
      load();
    } catch (e) {
      setFlash({ kind: "bad", text: e instanceof Error ? e.message : String(e) });
    }
  }

  if (error) return <div className="banner bad">⚠ {error}</div>;
  if (!leads) return <div className="spin">Loading approval queue…</div>;

  return (
    <>
      <div className="page-head">
        <h1>Approvals</h1>
        <span className="sub">
          {visibleQueue.reduce((n, x) => n + x.drafts.length, 0)}
          {repFilter !== "all" ? ` of ${queue.reduce((n, x) => n + x.drafts.length, 0)}` : ""} Arnold draft(s) awaiting a human
        </span>
        <span className="spacer" />
        <select value={repFilter} onChange={(e) => setRepFilter(e.target.value)} aria-label="Filter by rep">
          <option value="all">All reps</option>
          {repOptions.map((r) => (
            <option key={r} value={r}>{r}&apos;s leads</option>
          ))}
        </select>
      </div>
      {flash && <div className={`banner ${flash.kind}`}>{flash.kind === "good" ? "✓" : "⚠"} {flash.text}</div>}
      {visibleQueue.length === 0 && (
        <div className="card">
          <div className="muted">
            {repFilter === "all"
              ? "The queue is clear. Open a lead and click Ask Arnold to generate the next text + email suggestion, or let the stale sweep hand old leads to Arnold automatically."
              : `No pending drafts on ${repFilter}'s leads. Switch to "All reps" to see the whole queue.`}
          </div>
        </div>
      )}
      {visibleQueue.map(({ lead, drafts }) => (
        <div key={lead.id} className="card" style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "baseline", marginBottom: 10 }}>
            <Link href={`/leads/${encodeURIComponent(lead.id)}`} className="lead-name" style={{ fontSize: 16 }}>
              {lead.name}
            </Link>
            <span className="muted">{lead.headline || lead.leadType}</span>
            <RepBadge rep={lead.effectiveRep} />
            <StaleBadge lead={lead} />
          </div>
          {drafts.map((d) => (
            <QueueDraft
              key={`${d.channel}-${d.createdAt}`}
              targetLabel={d.channel === "sms" ? lead.phoneDialable || "⚠ no phone" : lead.emailClean || "⚠ no email"}
              draft={d}
              onAct={(action, body, subject, feedback) => act(lead.id, d.createdAt, d.channel, action, body, subject, feedback)}
            />
          ))}
        </div>
      ))}
    </>
  );
}

function QueueDraft({
  draft,
  targetLabel,
  onAct,
}: {
  draft: { channel: string; body: string; subject?: string; note?: string; createdBy: string };
  targetLabel: string;
  onAct: (action: "approve_send" | "dismiss" | "train", body: string, subject: string, feedback?: string) => Promise<void>;
}) {
  const [body, setBody] = useState(draft.body);
  const [subject, setSubject] = useState(draft.subject || "");
  const [busy, setBusy] = useState(false);
  const [coaching, setCoaching] = useState(false);
  const [feedback, setFeedback] = useState("");

  async function run(action: "approve_send" | "dismiss" | "train") {
    setBusy(true);
    await onAct(action, body, subject, feedback.trim() || undefined);
    setBusy(false);
    if (action === "train") { setCoaching(false); setFeedback(""); }
  }

  return (
    <div className={`draft ${draft.channel}`}>
      <div className="head">
        <strong>{draft.channel === "sms" ? "📱 Text" : "✉️ Email"}</strong>
        <span>→ {targetLabel}</span>
      </div>
      {draft.note && <div className="muted" style={{ marginBottom: 8 }}>💡 {draft.note}</div>}
      {draft.channel === "email" && (
        <input style={{ width: "100%", marginBottom: 8 }} value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" />
      )}
      <textarea rows={draft.channel === "sms" ? 3 : 7} value={body} onChange={(e) => setBody(e.target.value)} />
      <div className="actions">
        <button className="btn small" onClick={() => run("approve_send")} disabled={busy}>
          {busy ? "Working…" : "Approve & send"}
        </button>
        <button className="btn ghost small" onClick={() => run("dismiss")} disabled={busy}>Dismiss</button>
        <button className="btn ghost small" onClick={() => setCoaching((v) => !v)} disabled={busy}>
          🎓 Train Arnold
        </button>
      </div>
      {coaching && (
        <div style={{ marginTop: 10, padding: 12, background: "#f7f2ea", borderRadius: 8 }}>
          <label className="field">How could this response be better? Arnold records the lesson and rewrites the draft.</label>
          <textarea
            rows={3}
            placeholder="e.g. Too pushy for a first follow-up — lead with the free showroom visit, don't mention financing until they ask…"
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            autoFocus
          />
          <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
            <button className="btn small" onClick={() => run("train")} disabled={busy || !feedback.trim()}>
              {busy ? "Sending…" : "Send coaching"}
            </button>
            <button className="btn ghost small" onClick={() => { setCoaching(false); setFeedback(""); }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
