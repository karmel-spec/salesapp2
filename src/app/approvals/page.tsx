"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { Lead } from "@/lib/leads";
import { api, fetchLeads, getWho } from "@/lib/client";
import { RepBadge, StaleBadge } from "@/components/ui";

/** Approval queue: every pending Arnold draft across all leads. */
export default function ApprovalsPage() {
  const [leads, setLeads] = useState<Lead[] | null>(null);
  const [error, setError] = useState("");
  const [flash, setFlash] = useState<{ kind: "good" | "bad"; text: string } | null>(null);

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

  async function act(leadId: string, createdAt: string, channel: string, action: "approve_send" | "dismiss", body: string, subject: string) {
    setFlash(null);
    try {
      const r = await api<{ detail?: string; status: string }>(`/api/leads/${encodeURIComponent(leadId)}/drafts`, {
        method: "POST",
        body: JSON.stringify({ createdAt, channel, action, body, subject, who: getWho() }),
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
        <span className="sub">{queue.reduce((n, x) => n + x.drafts.length, 0)} Arnold draft(s) awaiting a human</span>
      </div>
      {flash && <div className={`banner ${flash.kind}`}>{flash.kind === "good" ? "✓" : "⚠"} {flash.text}</div>}
      {queue.length === 0 && (
        <div className="card">
          <div className="muted">
            The queue is clear. Open a lead and click <strong>Ask Arnold</strong> to generate the next text +
            email suggestion, or let the stale sweep hand old leads to Arnold automatically.
          </div>
        </div>
      )}
      {queue.map(({ lead, drafts }) => (
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
              onAct={(action, body, subject) => act(lead.id, d.createdAt, d.channel, action, body, subject)}
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
  onAct: (action: "approve_send" | "dismiss", body: string, subject: string) => Promise<void>;
}) {
  const [body, setBody] = useState(draft.body);
  const [subject, setSubject] = useState(draft.subject || "");
  const [busy, setBusy] = useState(false);

  async function run(action: "approve_send" | "dismiss") {
    setBusy(true);
    await onAct(action, body, subject);
    setBusy(false);
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
      </div>
    </div>
  );
}
