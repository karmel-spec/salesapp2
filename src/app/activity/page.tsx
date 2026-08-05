"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { Lead } from "@/lib/leads";
import { api, fetchLeads, getWho, leadValue } from "@/lib/client";
import { Linkify } from "@/components/ui";
import { Thread } from "@/components/Thread";
import { ThreadComposer } from "@/components/ThreadComposer";
import { messageSource, SOURCE_META } from "@/lib/source";
import { SourceIcon } from "@/components/SourceIcon";
import { looseIncludes } from "@/lib/search";

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
  source?: string; // channel the message arrived on (text/webchat/instagram/…)
  openedAt?: string; // email_out only: customer opened the email
  folder?: string; // inbound only: inbox folder ("" = general inbox)
  archived: boolean; // inbound only: closed out ("Done")
  leadBucket: string; // lead's status bucket (closed-out leads leave the inbox)
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
  { key: "unread", label: "Unread" },
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

/** Won/closed/lost/inactive/unqualified leads drop out of the inbox. */
const CLOSED_BUCKETS = new Set(["won", "closed", "lost", "inactive", "unqualified"]);

/** "8/19", "8/19/26", "8/19/2026", or "2026-08-19" → "8/19/2026" (or null). */
function parseSnoozeDate(input: string): string | null {
  const s = input.trim();
  let y = 0, m = 0, d = 0;
  let match = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (match) [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  else if ((match = s.match(/^(\d{1,2})[\/.-](\d{1,2})(?:[\/.-](\d{2,4}))?$/))) {
    m = Number(match[1]);
    d = Number(match[2]);
    y = match[3] ? Number(match[3]) : new Date().getFullYear();
    if (y < 100) y += 2000;
    // "8/19" with no year, already past → they mean next year.
    if (!match[3] && new Date(y, m - 1, d, 23, 59) < new Date()) y += 1;
  } else return null;
  const dt = new Date(y, m - 1, d);
  if (isNaN(dt.getTime()) || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
  return `${m}/${d}/${y}`;
}

/** Inbound replies arrive as "Customer texted…" or "Customer emailed…". */
function isEmailReply(r: Row): boolean {
  return /email/i.test(r.text.slice(0, 30));
}

/** Email-inbox style one-liner: subject (emails) + message snippet. */
function replySummary(r: Row): { subject: string; snippet: string } {
  const subject = r.text.match(/\("([^"]{1,90})"\)/)?.[1] || "";
  let body = r.text;
  const colon = body.indexOf(":");
  if (colon > -1 && colon < 60) body = body.slice(colon + 1);
  body = body.replace(/^[\s"“]+/, "").replace(/\s+/g, " ").trim();
  return { subject, snippet: body.slice(0, 110) };
}

export default function ActivityPage() {
  const [leads, setLeads] = useState<Lead[] | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState(() => initialFilter());
  const [who, setWho] = useState("all");
  const [sortMode, setSortMode] = useState("unread");
  const [inboxTab, setInboxTab] = useState<"sales" | "general">(() => {
    if (typeof window === "undefined") return "sales";
    return new URLSearchParams(window.location.search).get("tab") === "general" ? "general" : "sales";
  });
  const [folders, setFolders] = useState<{ name: string; tab: "sales" | "general" }[]>([
    { name: "Leads", tab: "sales" },
    { name: "Tuning", tab: "general" },
    { name: "Moving", tab: "general" },
  ]);
  const [doneFilter, setDoneFilter] = useState<"open" | "closed">("open");
  const [search, setSearch] = useState("");
  const [folderFilter, setFolderFilter] = useState<string>(() => {
    if (typeof window === "undefined") return "all";
    return new URLSearchParams(window.location.search).get("tab") === "general" ? "inbox" : "all";
  }); // "inbox" | "all" | folder name
  const [addingFolder, setAddingFolder] = useState(false);
  const [newFolder, setNewFolder] = useState("");
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
    api<{ folders: { name: string; tab: "sales" | "general" }[] }>("/api/folders")
      .then((r) => setFolders(r.folders))
      .catch(() => {});
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
          folder: e.folder || "",
          archived: Boolean(e.archivedAt),
          leadBucket: l.statusBucket,
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

  const unreadCount = useMemo(
    () => rows.filter((r) => r.kind === "inbound" && !r.read && !r.archived && !CLOSED_BUCKETS.has(r.leadBucket)).length,
    [rows]
  );

  const salesFolderSet = useMemo(
    () => new Set(folders.filter((f) => f.tab === "sales").map((f) => f.name.toLowerCase())),
    [folders]
  );

  const tabCounts = useMemo(() => {
    let sales = 0;
    let general = 0;
    for (const r of rows) {
      if (r.kind !== "inbound" || r.read || r.archived || CLOSED_BUCKETS.has(r.leadBucket)) continue;
      if (salesFolderSet.has((r.folder || "").toLowerCase())) sales++;
      else general++;
    }
    return { sales, general };
  }, [rows, salesFolderSet]);

  const folderCounts = useMemo(() => {
    const counts: Record<string, number> = { inbox: 0 };
    for (const r of rows) {
      if (r.kind !== "inbound" || r.read || r.archived || CLOSED_BUCKETS.has(r.leadBucket)) continue;
      const key = (r.folder || "").toLowerCase() || "inbox";
      counts[key] = (counts[key] || 0) + 1;
    }
    return counts;
  }, [rows]);

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
      // Two inboxes: Sales = sales-tab folders; General = the rest.
      const inSales = (r: Row) => salesFolderSet.has((r.folder || "").toLowerCase());
      const kept = out.filter(
        (r) =>
          !CLOSED_BUCKETS.has(r.leadBucket) &&
          (doneFilter === "closed" ? r.archived : !r.archived) &&
          (inboxTab === "sales" ? inSales(r) : !inSales(r))
      );
      out.length = 0;
      out.push(...kept);
      const needle = search.trim();
      if (needle) {
        const hits = out.filter((r) =>
          looseIncludes(`${r.leadName} ${r.headline} ${r.text}`, needle)
        );
        out.length = 0;
        out.push(...hits);
      }
      if (folderFilter === "inbox" && inboxTab === "general") {
        const keep = out.filter((r) => !r.folder);
        out.length = 0;
        out.push(...keep);
      } else if (folderFilter !== "all" && folderFilter !== "inbox") {
        const keep = out.filter((r) => (r.folder || "").toLowerCase() === folderFilter.toLowerCase());
        out.length = 0;
        out.push(...keep);
      }
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
  }, [rows, filter, who, sortMode, folderFilter, inboxTab, doneFilter, salesFolderSet, search]);

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

  /** File a response into a folder ("" = general inbox). */
  async function fileTo(r: Row, folder: string) {
    setLeads((cur) =>
      cur
        ? cur.map((l) =>
            l.id !== r.leadId
              ? l
              : {
                  ...l,
                  timeline: l.timeline.map((e) =>
                    e.kind === "inbound" && e.at === r.at ? { ...e, folder: folder || undefined } : e
                  ),
                }
          )
        : cur
    );
    try {
      await api("/api/inbox", {
        method: "POST",
        body: JSON.stringify({ leadId: r.leadId, ats: [r.at], folder, who: getWho() }),
      });
    } catch {
      reload();
    }
  }

  /** Quick status toggle from an inbox row — closed-out statuses remove the
   *  client's replies from this inbox entirely. */
  async function setLeadStatus(r: Row, choice: string) {
    let status = choice;
    let snoozeNote = "";
    if (choice === "LOST") {
      const reason = window.prompt("Why was this lead lost? (recorded in the sheet)");
      if (reason === null) return;
      status = `LOST - ${reason.trim() || "no reason given"}`;
    }
    if (choice === "SNOOZE") {
      const when = window.prompt("Snooze until when? (e.g. 8/19 or 8/19/2026)");
      if (when === null) return;
      const pretty = parseSnoozeDate(when);
      if (!pretty) {
        window.alert("Couldn't understand that date — try something like 8/19/2026.");
        return;
      }
      snoozeNote = (window.prompt("Any notes to add to the snooze? (optional)") || "").trim();
      status = `Snoozed until ${pretty}`;
    }
    const bucketGuess =
      choice === "WON"
        ? "won"
        : choice === "SNOOZE"
          ? "snoozed"
          : choice.toLowerCase().startsWith("lost")
            ? "lost"
            : choice.toLowerCase();
    setLeads((cur) =>
      cur
        ? cur.map((l) =>
            l.id === r.leadId ? { ...l, status, statusBucket: (bucketGuess as Lead["statusBucket"]) || l.statusBucket } : l
          )
        : cur
    );
    try {
      await api(`/api/leads/${encodeURIComponent(r.leadId)}`, {
        method: "PATCH",
        body: JSON.stringify({ fields: { status }, who: getWho() }),
      });
      if (choice === "SNOOZE") {
        await api(`/api/leads/${encodeURIComponent(r.leadId)}/timeline`, {
          method: "POST",
          body: JSON.stringify({
            kind: "note",
            text: `💤 ${status} (from the inbox)${snoozeNote ? ` — ${snoozeNote}` : ""} — will wake to Active automatically.`,
            who: getWho(),
          }),
        });
      }
    } catch {
      reload();
    }
  }

  /** Ack every unread message in a client's group. */
  async function ackGroup(group: Row[]) {
    const unreadAts = group.filter((r) => !r.read).map((r) => r.at);
    if (!unreadAts.length) return;
    applyRead(group[0].leadId, unreadAts);
    try {
      await api("/api/inbox", {
        method: "POST",
        body: JSON.stringify({ leadId: group[0].leadId, ats: unreadAts, who: getWho() }),
      });
    } catch {
      reload();
    }
  }

  /** File every message in a client's group into a folder. */
  async function fileGroup(group: Row[], folder: string) {
    const ats = group.map((r) => r.at);
    setLeads((cur) =>
      cur
        ? cur.map((l) =>
            l.id !== group[0].leadId
              ? l
              : {
                  ...l,
                  timeline: l.timeline.map((e) =>
                    e.kind === "inbound" && ats.includes(e.at) ? { ...e, folder: folder || undefined } : e
                  ),
                }
          )
        : cur
    );
    try {
      await api("/api/inbox", {
        method: "POST",
        body: JSON.stringify({ leadId: group[0].leadId, ats, folder, who: getWho() }),
      });
    } catch {
      reload();
    }
  }

  /** "Done" — close a client's line out of the inbox (or reopen it). */
  async function archiveGroup(group: Row[], archive: boolean) {
    const ats = group.map((r) => r.at);
    const now = new Date().toISOString();
    setLeads((cur) =>
      cur
        ? cur.map((l) =>
            l.id !== group[0].leadId
              ? l
              : {
                  ...l,
                  timeline: l.timeline.map((e) => {
                    if (e.kind !== "inbound" || !ats.includes(e.at)) return e;
                    if (archive) return { ...e, archivedAt: now, archivedBy: getWho(), readAt: e.readAt || now };
                    const { archivedAt: _a, archivedBy: _b, ...rest } = e;
                    return rest;
                  }),
                }
          )
        : cur
    );
    try {
      await api("/api/inbox", {
        method: "POST",
        body: JSON.stringify({ leadId: group[0].leadId, ats, archive, who: getWho() }),
      });
    } catch {
      reload();
    }
  }

  async function createFolder() {
    const name = newFolder.trim();
    if (!name) return;
    try {
      const r = await api<{ folders: { name: string; tab: "sales" | "general" }[] }>("/api/folders", {
        method: "POST",
        body: JSON.stringify({ name, tab: inboxTab, who: getWho() }),
      });
      setFolders(r.folders);
      setFolderFilter(name);
      setAddingFolder(false);
      setNewFolder("");
    } catch {
      /* keep the input open */
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
        <>
          <div className="inbox-tabs">
            <button
              className={`inbox-tab sales${inboxTab === "sales" ? " active" : ""}`}
              onClick={() => {
                setInboxTab("sales");
                setFolderFilter("all");
              }}
            >
              🎹 Sales Inbox
              {tabCounts.sales > 0 && <span className="unread-count">{tabCounts.sales}</span>}
            </button>
            <button
              className={`inbox-tab general${inboxTab === "general" ? " active" : ""}`}
              onClick={() => {
                setInboxTab("general");
                setFolderFilter("inbox");
              }}
            >
              🏪 General Inbox
              {tabCounts.general > 0 && <span className="unread-count">{tabCounts.general}</span>}
            </button>
            <span className="muted" style={{ fontSize: 12, alignSelf: "center" }}>
              {inboxTab === "sales"
                ? "replies to sales-lead efforts (the Leads folder)"
                : "every other inquiry — tuning, moving, questions"}
            </span>
          </div>
          <div className="folder-row">
            {[
              ...(inboxTab === "general" ? [{ key: "inbox", label: "📥 Inbox" }] : []),
              { key: "all", label: "All" },
              ...folders.filter((f) => f.tab === inboxTab).map((f) => ({ key: f.name, label: `📁 ${f.name}` })),
            ].map((f) => (
              <button
                key={f.key}
                className={`folder-chip${folderFilter.toLowerCase() === f.key.toLowerCase() ? " active" : ""}`}
                onClick={() => setFolderFilter(f.key)}
              >
                {f.label}
                {f.key !== "all" && (folderCounts[f.key.toLowerCase()] || 0) > 0 && (
                  <span className="unread-count">{folderCounts[f.key.toLowerCase()]}</span>
                )}
              </button>
            ))}
            {addingFolder ? (
              <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                <input
                  placeholder="New folder name"
                  value={newFolder}
                  onChange={(e) => setNewFolder(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && createFolder()}
                  style={{ padding: "4px 8px", fontSize: 13 }}
                  autoFocus
                />
                <button className="btn small" onClick={createFolder} disabled={!newFolder.trim()}>Add</button>
                <button className="btn small ghost" onClick={() => setAddingFolder(false)}>✕</button>
              </span>
            ) : (
              <button className="folder-chip" onClick={() => setAddingFolder(true)}>＋ New folder</button>
            )}
            <span style={{ flex: 1 }} />
            <button
              className={`folder-chip${doneFilter === "open" ? " active" : ""}`}
              onClick={() => setDoneFilter("open")}
              title="Lines still being worked"
            >
              Open
            </button>
            <button
              className={`folder-chip${doneFilter === "closed" ? " active" : ""}`}
              onClick={() => setDoneFilter("closed")}
              title="Lines marked Done"
            >
              ✓ Closed
            </button>
          </div>
          <p className="muted" style={{ fontSize: 13, margin: "0 0 10px" }}>
            <strong>Bold</strong> = new. The checkbox marks read/unread, the 📁 menu files a response into a
            folder, and clicking it opens the conversation beside the list.
          </p>
        </>
      )}

      <div className="split" ref={splitRef}>
        <div className="split-left" style={{ width: threadLead ? `${leftPct}%` : "100%" }}>
          <div className="card">
            {filter === "inbound" && (
              <input
                type="search"
                className="inbox-search"
                placeholder="🔍 Search the inbox — name, message, or piano…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            )}
            {visible.length === 0 && (
              <div className="muted">
                {filter === "inbound" && search.trim()
                  ? `Nothing matches “${search.trim()}” here.`
                  : "No activity matches this filter yet."}
              </div>
            )}
            {filter === "inbound" ? (
              <div className="inbox-list">
                {(() => {
                  // One line per client: their messages grouped, newest first.
                  const order: string[] = [];
                  const byLead = new Map<string, Row[]>();
                  for (const r of visible) {
                    if (!byLead.has(r.leadId)) {
                      byLead.set(r.leadId, []);
                      order.push(r.leadId);
                    }
                    byLead.get(r.leadId)!.push(r);
                  }
                  return order.map((leadId) => {
                    const group = byLead.get(leadId)!;
                    const latest = group[0];
                    const unread = group.filter((x) => !x.read).length;
                    const d = new Date(latest.at);
                    const stamp = !isNaN(d.getTime())
                      ? d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) +
                        " · " +
                        d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
                      : "—";
                    const { subject, snippet } = replySummary(latest);
                    return (
                      <div
                        key={leadId}
                        className={`inbox-row${unread ? " unread" : ""}${threadLead && leadId === threadLead.id ? " thread-open" : ""}`}
                        onClick={() => {
                          ackGroup(group);
                          setThreadId(leadId);
                        }}
                        title={unread ? "Click to open the conversation (marks all read)" : "Click to open the conversation"}
                      >
                        <input
                          type="checkbox"
                          className="read-check"
                          checked={unread === 0}
                          title={unread ? `Mark all ${unread} as read` : "All read — uncheck to mark the newest as NEW"}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => {
                            e.stopPropagation();
                            if (unread) ackGroup(group);
                            else unackOne(latest);
                          }}
                        />
                        {(() => {
                          const src =
                            messageSource(latest) || (isEmailReply(latest) ? "email" : "text");
                          return (
                            <span className="ib-icon" title={SOURCE_META[src]?.label || "Message"}>
                              <SourceIcon source={src} />
                            </span>
                          );
                        })()}
                        <span className="ib-name">
                          {latest.leadName}
                          {unread > 0 && <span className="msg-count" title={`${unread} waiting message${unread === 1 ? "" : "s"}`}>{unread}</span>}
                          {unread === 0 && group.length > 1 && <span className="msg-count read" title={`${group.length} messages`}>{group.length}</span>}
                        </span>
                        <span className="ib-snippet">
                          {subject && <strong>{subject}</strong>}
                          {subject && snippet ? " — " : ""}
                          {snippet}
                        </span>
                        <select
                          className="file-select"
                          value={latest.folder || ""}
                          title="File this client's messages into a folder"
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => {
                            e.stopPropagation();
                            fileGroup(group, e.target.value);
                          }}
                        >
                          <option value="">📥 Inbox</option>
                          <optgroup label="Sales">
                            {folders.filter((f) => f.tab === "sales").map((f) => (
                              <option key={f.name} value={f.name}>📁 {f.name}</option>
                            ))}
                          </optgroup>
                          <optgroup label="General">
                            {folders.filter((f) => f.tab === "general").map((f) => (
                              <option key={f.name} value={f.name}>📁 {f.name}</option>
                            ))}
                          </optgroup>
                        </select>
                        <select
                          className="file-select status-select"
                          value=""
                          title="Quick status — Won/Closed/etc. removes this client from the inbox"
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => {
                            e.stopPropagation();
                            if (e.target.value) setLeadStatus(latest, e.target.value);
                          }}
                        >
                          <option value="">{latest.leadBucket || "status"}</option>
                          <option value="Active">Active</option>
                          <option value="SNOOZE">Snooze 💤…</option>
                          <option value="WON">Won ✓</option>
                          <option value="Closed">Closed</option>
                          <option value="Inactive">Inactive</option>
                          <option value="Unqualified">Unqualified</option>
                          <option value="LOST">Lost…</option>
                        </select>
                        {doneFilter === "open" ? (
                          <button
                            className="done-btn"
                            title="Done — taken care of; closes this line out of the inbox"
                            onClick={(e) => {
                              e.stopPropagation();
                              archiveGroup(group, true);
                            }}
                          >
                            ✓ Done
                          </button>
                        ) : (
                          <button
                            className="done-btn reopen"
                            title="Reopen — put this line back in the inbox"
                            onClick={(e) => {
                              e.stopPropagation();
                              archiveGroup(group, false);
                            }}
                          >
                            ↩ Reopen
                          </button>
                        )}
                        <span className="ib-time">{stamp}</span>
                      </div>
                    );
                  });
                })()}
              </div>
            ) : (
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
                      {r.kind === "inbound" && (
                        <select
                          className="file-select"
                          value={r.folder || ""}
                          title="File this response into a folder"
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => {
                            e.stopPropagation();
                            fileTo(r, e.target.value);
                          }}
                        >
                          <option value="">📥 Inbox</option>
                          {folders.map((f) => (
                            <option key={f.name} value={f.name}>📁 {f.name}</option>
                          ))}
                        </select>
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
            )}
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
                    <Link
                      href={`/leads/${encodeURIComponent(threadLead.id)}`}
                      style={{ fontFamily: "var(--serif)", fontSize: 17, fontWeight: 700, textDecoration: "underline", textDecorationColor: "var(--line)" }}
                      title="Open the full lead"
                    >
                      {threadLead.name}
                    </Link>
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
