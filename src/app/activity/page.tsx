"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { Lead } from "@/lib/leads";
import { api, fetchLeads, getWho } from "@/lib/client";
import { Linkify } from "@/components/ui";
import { Thread } from "@/components/Thread";

type Row = {
  at: string;
  who: string;
  kind: string;
  text: string;
  leadId: string;
  leadName: string;
  headline: string;
  read: boolean; // inbound only: acknowledged as read?
  readBy?: string;
};

const KIND_META: Record<string, { label: string; icon: string }> = {
  sms_out: { label: "Text sent", icon: "📱" },
  email_out: { label: "Email sent", icon: "✉️" },
  inbound: { label: "Customer replied", icon: "📥" },
  call: { label: "Call", icon: "📞" },
  call_attempt: { label: "Call started", icon: "📞" },
  draft: { label: "Arnold drafted", icon: "✍️" },
  note: { label: "Note", icon: "📝" },
  edit: { label: "Edited", icon: "✎" },
  assign: { label: "Reassigned", icon: "↪" },
  created: { label: "Lead created", icon: "✨" },
};

const FILTERS: { key: string; label: string; kinds: string[] }[] = [
  { key: "all", label: "Everything", kinds: [] },
  { key: "outbound", label: "Sent to customers", kinds: ["sms_out", "email_out", "call", "call_attempt"] },
  { key: "inbound", label: "Customer replies", kinds: ["inbound"] },
  { key: "arnold", label: "Arnold drafts", kinds: ["draft"] },
  { key: "coaching", label: "Train Arnold (coaching)", kinds: ["coaching"] },
  { key: "followup", label: "Follow-up instructions", kinds: ["followup"] },
  { key: "notes", label: "Notes & edits", kinds: ["note", "edit", "assign", "created"] },
];

/**
 * Conversation popup: the full back-and-forth between one client and BLP,
 * oldest first — customer messages on the left, BLP's on the right.
 */
function ThreadModal({ lead, onClose }: { lead: Lead; onClose: () => void }) {
  // Esc closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-label={`Conversation with ${lead.name}`} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <strong style={{ fontFamily: "var(--serif)", fontSize: 17 }}>{lead.name}</strong>
            {lead.headline && <div className="muted">{lead.headline}</div>}
          </div>
          <span className="spacer" />
          <Link className="btn small" href={`/leads/${encodeURIComponent(lead.id)}`}>
            Open lead →
          </Link>
          <button className="btn small ghost" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <Thread lead={lead} />
      </div>
    </div>
  );
}

/** ?filter=inbound deep link (the top-corner alert lands here). */
function initialFilter(): string {
  if (typeof window === "undefined") return "all";
  const f = new URLSearchParams(window.location.search).get("filter") || "all";
  return FILTERS.some((x) => x.key === f) ? f : "all";
}

export default function ActivityPage() {
  const [leads, setLeads] = useState<Lead[] | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState(() => initialFilter());
  const [who, setWho] = useState("all");
  const [marking, setMarking] = useState(false);
  const [threadId, setThreadId] = useState<string | null>(null); // lead whose conversation is open

  useEffect(() => {
    fetchLeads(true).then((r) => setLeads(r.leads)).catch((e) => setError(e.message));
  }, []);

  const rows = useMemo(() => {
    if (!leads) return [];
    const all: Row[] = [];
    for (const l of leads) {
      for (const e of l.timeline) {
        all.push({
          ...e,
          leadId: l.id,
          leadName: l.name,
          headline: l.headline || l.leadType || "",
          read: e.kind === "inbound" ? Boolean(e.readAt) : true,
          readBy: e.readBy,
        });
      }
    }
    const t = (r: Row) => {
      const d = new Date(r.at);
      return isNaN(d.getTime()) ? 0 : d.getTime();
    };
    return all.sort((a, b) => t(b) - t(a));
  }, [leads]);

  const unreadCount = useMemo(() => rows.filter((r) => r.kind === "inbound" && !r.read).length, [rows]);

  const whoOptions = useMemo(
    () => Array.from(new Set(rows.map((r) => r.who).filter(Boolean))).sort(),
    [rows]
  );

  const visible = useMemo(() => {
    const kinds = FILTERS.find((f) => f.key === filter)?.kinds || [];
    const out = rows
      .filter((r) => (kinds.length ? kinds.includes(r.kind) : true))
      .filter((r) => (who === "all" ? true : r.who === who));
    // Inbox view: every NEW response floats to the top (newest first within
    // each group) — read ones settle below.
    if (filter === "inbound") {
      out.sort((a, b) => Number(a.read) - Number(b.read));
    }
    return out.slice(0, 250);
  }, [rows, filter, who]);

  /** Flip events read in local state so the UI reacts instantly. */
  function applyRead(leadId: string | null, ats: string[] | null) {
    setLeads((cur) =>
      cur
        ? cur.map((l) => {
            if (leadId && l.id !== leadId) return l;
            return {
              ...l,
              timeline: l.timeline.map((e) =>
                e.kind === "inbound" && !e.readAt && (!ats || ats.includes(e.at))
                  ? { ...e, readAt: new Date().toISOString(), readBy: getWho() }
                  : e
              ),
            };
          })
        : cur
    );
  }

  async function ackOne(r: Row) {
    if (r.kind !== "inbound" || r.read) return;
    applyRead(r.leadId, [r.at]); // optimistic
    try {
      await api("/api/inbox", { method: "POST", body: JSON.stringify({ leadId: r.leadId, ats: [r.at], who: getWho() }) });
    } catch {
      fetchLeads(true).then((res) => setLeads(res.leads)).catch(() => {});
    }
  }

  /** Clicking a client response acknowledges it AND opens the conversation. */
  function openResponse(r: Row) {
    if (r.kind !== "inbound") return;
    ackOne(r);
    setThreadId(r.leadId);
  }

  /** Flip an acknowledged response back to NEW (unread). */
  async function unackOne(r: Row) {
    if (r.kind !== "inbound" || !r.read) return;
    setLeads((cur) =>
      cur
        ? cur.map((l) =>
            l.id !== r.leadId
              ? l
              : {
                  ...l,
                  timeline: l.timeline.map((e) => {
                    if (e.kind !== "inbound" || e.at !== r.at) return e;
                    const { readBy: _rb, readAt: _ra, ...rest } = e;
                    return rest;
                  }),
                }
          )
        : cur
    );
    try {
      await api("/api/inbox", {
        method: "POST",
        body: JSON.stringify({ leadId: r.leadId, ats: [r.at], who: getWho(), unread: true }),
      });
    } catch {
      fetchLeads(true).then((res) => setLeads(res.leads)).catch(() => {});
    }
  }

  async function ackAll() {
    setMarking(true);
    applyRead(null, null); // optimistic
    try {
      await api("/api/inbox", { method: "POST", body: JSON.stringify({ all: true, who: getWho() }) });
    } catch {
      fetchLeads(true).then((res) => setLeads(res.leads)).catch(() => {});
    } finally {
      setMarking(false);
    }
  }

  if (error) return <div className="banner bad">⚠ {error}</div>;
  if (!leads) return <div className="spin">Loading activity…</div>;

  let lastDay = "";

  return (
    <>
      <div className="page-head">
        <h1>Activity</h1>
        <span className="sub">everything the team and Arnold have done, newest first</span>
      </div>

      <div className="toolbar">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            className={`btn small ${filter === f.key ? "" : "ghost"}`}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
            {f.key === "inbound" && unreadCount > 0 && <span className="unread-count">{unreadCount}</span>}
          </button>
        ))}
        <select value={who} onChange={(e) => setWho(e.target.value)}>
          <option value="all">Everyone</option>
          {whoOptions.map((w) => (
            <option key={w} value={w}>{w}</option>
          ))}
        </select>
        {filter === "inbound" && unreadCount > 0 && (
          <button className="btn small ghost" onClick={ackAll} disabled={marking}>
            {marking ? "Marking…" : `✓ Mark all ${unreadCount} as read`}
          </button>
        )}
      </div>

      {filter === "inbound" && (
        <p className="muted" style={{ fontSize: 13, margin: "0 0 10px" }}>
          Your client-response inbox. <strong>Bold</strong> = new — click a response to acknowledge it as read.
        </p>
      )}

      <div className="card">
        {visible.length === 0 && <div className="muted">No activity matches this filter yet.</div>}
        <ul className="timeline">
          {visible.map((r, i) => {
            const d = new Date(r.at);
            const valid = !isNaN(d.getTime());
            const day = valid
              ? d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })
              : "Earlier (undated)";
            // Inbox view is sorted unread-first (not chronological), so per-day
            // headers would repeat — each row shows its full date instead.
            const showDay = filter !== "inbound" && day !== lastDay;
            lastDay = day;
            const meta = KIND_META[r.kind] || { label: r.kind, icon: "•" };
            const isUnread = r.kind === "inbound" && !r.read;
            const stamp = valid
              ? filter === "inbound"
                ? d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) +
                  ", " +
                  d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
                : d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
              : r.at || "—";
            return (
              <li
                key={`${r.leadId}-${r.at}-${i}`}
                className={isUnread ? "unread" : undefined}
                onClick={() => openResponse(r)}
                title={
                  r.kind === "inbound"
                    ? isUnread
                      ? "Click to open the conversation (marks it read)"
                      : "Click to open the conversation"
                    : undefined
                }
                style={r.kind === "inbound" ? { cursor: "pointer" } : undefined}
              >
                {showDay && (
                  <div style={{ fontFamily: "var(--serif)", fontWeight: 600, fontSize: 15, margin: "10px 0 6px" }}>
                    {day}
                  </div>
                )}
                <div className="meta">
                  {isUnread && <span className="new-chip">NEW</span>}
                  {stamp} · {meta.icon}{" "}
                  <strong>{meta.label}</strong> · {r.who} ·{" "}
                  <Link
                    href={`/leads/${encodeURIComponent(r.leadId)}`}
                    style={{ textDecoration: "underline" }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {r.leadName}
                  </Link>
                  {r.headline && <span className="muted"> — {r.headline}</span>}
                  {r.kind === "inbound" && r.read && (
                    <span className="muted">
                      {r.readBy && <> · ✓ read by {r.readBy}</>}{" "}
                      <button
                        className="linklike"
                        onClick={(e) => {
                          e.stopPropagation();
                          unackOne(r);
                        }}
                        title="Put this back in the NEW pile"
                      >
                        ↩ mark unread
                      </button>
                    </span>
                  )}
                </div>
                <div className="body"><Linkify text={r.text} /></div>
              </li>
            );
          })}
        </ul>
      </div>

      {threadId && (() => {
        const lead = leads.find((l) => l.id === threadId);
        return lead ? <ThreadModal lead={lead} onClose={() => setThreadId(null)} /> : null;
      })()}
    </>
  );
}
