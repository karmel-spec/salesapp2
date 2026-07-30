"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { Lead } from "@/lib/leads";
import { api, fetchLeads, getWho, leadValue } from "@/lib/client";
import { Linkify } from "@/components/ui";
import { Thread } from "@/components/Thread";
import { ThreadComposer } from "@/components/ThreadComposer";

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
  openedAt?: string; // email_out only: customer opened the email
  leadScore: number;
  leadValue: number;
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

const SORTS: { key: string; label: string }[] = [
  { key: "unread", label: "NEW first" },
  { key: "newest", label: "Newest first" },
  { key: "oldest-unread", label: "Waiting longest (unread)" },
  { key: "texts", label: "Texts first" },
  { key: "emails", label: "Emails first" },
  { key: "hot", label: "Hottest leads first" },
  { key: "value", label: "Highest $ value first" },
];

/** ?filter=inbound deep link (the top-corner alert lands here). */
function initialFilter(): string {
  if (typeof window === "undefined") return "all";
  const f = new URLSearchParams(window.location.search).get("filter") || "all";
  return FILTERS.some((x) => x.key === f) ? f : "all";
}

/** Inbound replies arrive as "Customer texted…" or "Customer emailed…". */
function isEmailReply(r: Row): boolean {
  return /email/i.test(r.text.slice(0, 30));
}

export default function ActivityPage() {
  const [leads, setLeads] = useState<Lead[] | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState(() => initialFilter());
  const [who, setWho] = useState("all");
  const [sortMode, setSortMode] = useState("unread");
  const [marking, setMarking] = useState(false);
  const [threadId, setThreadId] = useState<string | null>(null); // lead whose conversation is open
  const [leftPct, setLeftPct] = useState(55); // resizable split (% width of the list)
  const splitRef = useRef<HTMLDivElement>(null);
  const dragState = useRef({ dragging: false, pct: 55 });

  const reload = () =>
    fetchLeads(true)
      .then((r) => setLeads(r.leads))
      .catch((e) => setError(e.message));

  useEffect(() => {
    reload();
    const v = Number(localStorage.getItem("blp_activity_split"));
    if (v >= 28 && v <= 72) {
      setLeftPct(v);
      dragState.current.pct = v;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Draggable divider between the replies list and the conversation panel.
  useEffect(() => {
    const move = (clientX: number) => {
      if (!dragState.current.dragging || !splitRef.current) return;
      const rect = splitRef.current.getBoundingClientRect();
      const pct = Math.min(72, Math.max(28, ((clientX - rect.left) / rect.width) * 100));
      dragState.current.pct = pct;
      setLeftPct(pct);
    };
    const onMouse = (e: MouseEvent) => move(e.clientX);
    const onTouch = (e: TouchEvent) => move(e.touches[0]?.clientX ?? 0);
    const up = () => {
      if (!dragState.current.dragging) return;
      dragState.current.dragging = false;
      document.body.style.userSelect = "";
      localStorage.setItem("blp_activity_split", String(Math.round(dragState.current.pct)));
    };
    window.addEventListener("mousemove", onMouse);
    window.addEventListener("touchmove", onTouch);
    window.addEventListener("mouseup", up);
    window.addEventListener("touchend", up);
    return () => {
      window.removeEventListener("mousemove", onMouse);
      window.removeEventListener("touchmove", onTouch);
      window.removeEventListener("mouseup", up);
      window.removeEventListener("touchend", up);
    };
  }, []);

  // Esc closes the conversation panel.
  useEffect(() => {
    if (!threadId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setThreadId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [threadId]);

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
          openedAt: e.openedAt,
          leadScore: Number(l.score) || 0,
          leadValue: leadValue(l),
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
    // Sorts apply to the inbox view (rows start newest-first; sorts are
    // stable, so ties keep that order).
    if (filter === "inbound") {
      const t = (r: Row) => {
        const d = new Date(r.at);
        return isNaN(d.getTime()) ? 0 : d.getTime();
      };
      switch (sortMode) {
        case "newest":
          break;
        case "oldest-unread":
          out.sort((a, b) => Number(a.read) - Number(b.read) || t(a) - t(b));
          break;
        case "texts":
          out.sort((a, b) => Number(isEmailReply(a)) - Number(isEmailReply(b)));
          break;
        case "emails":
          out.sort((a, b) => Number(!isEmailReply(a)) - Number(!isEmailReply(b)));
          break;
        case "hot":
          out.sort((a, b) => b.leadScore - a.leadScore);
          break;
        case "value":
          out.sort((a, b) => b.leadValue - a.leadValue);
          break;
        default:
          out.sort((a, b) => Number(a.read) - Number(b.read)); // NEW first
      }
    }
    return out.slice(0, 250);
  }, [rows, filter, who, sortMode]);

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
      reload();
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
      reload();
    }
  }

  async function ackAll() {
    setMarking(true);
    applyRead(null, null); // optimistic
    try {
      await api("/api/inbox", { method: "POST", body: JSON.stringify({ all: true, who: getWho() }) });
    } catch {
      reload();
    } finally {
      setMarking(false);
    }
  }

  if (error) return <div className="banner bad">⚠ {error}</div>;
  if (!leads) return <div className="spin">Loading activity…</div>;

  const threadLead = threadId ? leads.find((l) => l.id === threadId) || null : null;
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
        {filter === "inbound" && (
          <select value={sortMode} onChange={(e) => setSortMode(e.target.value)} aria-label="Sort replies">
            {SORTS.map((s) => (
              <option key={s.key} value={s.key}>{s.label}</option>
            ))}
          </select>
        )}
        {filter === "inbound" && unreadCount > 0 && (
          <button className="btn small ghost" onClick={ackAll} disabled={marking}>
            {marking ? "Marking…" : `✓ Mark all ${unreadCount} as read`}
          </button>
        )}
      </div>

      {filter === "inbound" && (
        <p className="muted" style={{ fontSize: 13, margin: "0 0 10px" }}>
          Your client-response inbox. <strong>Bold</strong> = new — the checkbox marks read/unread; click a
          response to open the conversation beside it.
        </p>
      )}

      <div className="split" ref={splitRef}>
        <div className="split-left" style={{ width: threadLead ? `${leftPct}%` : "100%" }}>
          <div className="card">
            {visible.length === 0 && <div className="muted">No activity matches this filter yet.</div>}
            <ul className="timeline">
              {visible.map((r, i) => {
                const d = new Date(r.at);
                const valid = !isNaN(d.getTime());
                const day = valid
                  ? d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })
                  : "Earlier (undated)";
                // The inbox view isn't chronological, so per-day headers would
                // repeat — each row shows its full date instead.
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
                    className={`${isUnread ? "unread" : ""}${threadLead && r.leadId === threadLead.id ? " thread-open" : ""}`}
                    onClick={() => openResponse(r)}
                    title={r.kind === "inbound" ? "Click to open the conversation" : undefined}
                    style={r.kind === "inbound" ? { cursor: "pointer" } : undefined}
                  >
                    {showDay && (
                      <div style={{ fontFamily: "var(--serif)", fontWeight: 600, fontSize: 15, margin: "10px 0 6px" }}>
                        {day}
                      </div>
                    )}
                    <div className="meta">
                      {r.kind === "inbound" && (
                        <input
                          type="checkbox"
                          className="read-check"
                          checked={r.read}
                          title={r.read ? "Read — uncheck to mark as NEW again" : "Check to mark as read"}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => {
                            e.stopPropagation();
                            if (r.read) unackOne(r);
                            else ackOne(r);
                          }}
                        />
                      )}
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
                      {r.kind === "inbound" && r.read && r.readBy && (
                        <span className="muted"> · ✓ read by {r.readBy}</span>
                      )}
                      {r.kind === "email_out" && r.openedAt && (
                        <span className="opened-chip" title={`Customer opened this email ${new Date(r.openedAt).toLocaleString()}`}>
                          👁 opened{" "}
                          {new Date(r.openedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                        </span>
                      )}
                    </div>
                    <div className="body"><Linkify text={r.text} /></div>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>

        {threadLead && (
          <>
            <div
              className="split-divider"
              role="separator"
              aria-label="Drag to resize"
              title="Drag to resize"
              onMouseDown={(e) => {
                dragState.current.dragging = true;
                document.body.style.userSelect = "none";
                e.preventDefault();
              }}
              onTouchStart={() => {
                dragState.current.dragging = true;
              }}
            />
            <div className="split-right">
              <div className="card thread-panel">
                <div className="thread-panel-head">
                  <div>
                    <strong style={{ fontFamily: "var(--serif)", fontSize: 17 }}>{threadLead.name}</strong>
                    {threadLead.headline && <div className="muted">{threadLead.headline}</div>}
                  </div>
                  <span style={{ flex: 1 }} />
                  <Link className="btn small ghost" href={`/leads/${encodeURIComponent(threadLead.id)}`}>
                    Open lead →
                  </Link>
                  <button className="btn small ghost" onClick={() => setThreadId(null)} aria-label="Close conversation">
                    ✕
                  </button>
                </div>
                <Thread lead={threadLead} />
                <ThreadComposer lead={threadLead} onSent={reload} />
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}
