"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/client";
import type { Board, BoardRow, QueueCell, Status } from "@/lib/board";

/**
 * Team Inbox Board — the Heatmap design. Left: a matrix of people × queues,
 * each key colored by how long its oldest item has waited. Right: a focus
 * panel for the selected person with the actual oldest items.
 */

const QUEUES: { key: "email" | "tasks" | "console"; label: string; icon: string }[] = [
  { key: "email", label: "Email inbox", icon: "✉️" },
  { key: "tasks", label: "Store Map tasks", icon: "🗂️" },
  { key: "console", label: "Sales console", icon: "💬" },
];

const STATUS_WORD: Record<Status, string> = { behind: "behind", watch: "watch", current: "current", none: "—" };

function initials(name: string) {
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function cellSummary(c: QueueCell | undefined) {
  if (!c) return "no queue";
  if (c.note) return c.note;
  const oldest = c.oldestDays === null ? "nothing waiting" : c.oldestDays === 0 ? "today" : `${c.oldestDays}d`;
  return c.kind === "tasks" ? `${oldest}${c.overdue ? ` · ${c.overdue} overdue` : ""}` : `${oldest} · ${c.total} total`;
}

export function TeamBoard({ initialPerson }: { initialPerson?: string }) {
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<string>(initialPerson || "");
  const [loading, setLoading] = useState(false);

  // Sidebar person links change the route param without remounting.
  useEffect(() => {
    if (initialPerson) setSelected(initialPerson);
  }, [initialPerson]);

  const load = (refresh = false) => {
    setLoading(true);
    api<Board>(`/api/board${refresh ? "?refresh=1" : ""}`)
      .then((b) => {
        setBoard(b);
        if (!selected && b.rows[0]) setSelected(b.rows[0].key);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(() => {
    load();
    const iv = setInterval(() => load(), 120_000);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const focus = useMemo(() => board?.rows.find((r) => r.key === selected) || board?.rows[0], [board, selected]);

  if (error) return <div className="banner bad">⚠ {error}</div>;
  if (!board) return <div className="spin">Reading every inbox, task board and queue…</div>;

  const updated = new Date(board.updatedAt);

  return (
    <>
      <div className="page-head">
        <h1>Inbox Board</h1>
        <span className="sub">
          every queue a customer can be waiting in, by the person who owns it · updated{" "}
          {updated.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
        </span>
        <span className="spacer" />
        <button className="btn ghost small" onClick={() => load(true)} disabled={loading}>
          {loading ? "Refreshing…" : "↻ Refresh"}
        </button>
      </div>

      <div className="grid tiles board-tiles">
        <div className="card tile">
          <div className="label">Unread email</div>
          <div className="value">{board.totals.emailUnread.toLocaleString()}</div>
          <div className="hint">across every connected inbox</div>
        </div>
        <div className="card tile">
          <div className="label">Open task cards</div>
          <div className="value">{board.totals.openCards}</div>
          <div className="hint">Store Map boards</div>
        </div>
        <div className="card tile">
          <div className="label">Console queues</div>
          <div className="value">{board.totals.consoleNew}</div>
          <div className="hint">unread replies + new inquiries</div>
        </div>
        <div className={`card tile ${board.totals.behind ? "alert" : ""}`}>
          <div className="label">People behind</div>
          <div className="value">{board.totals.behind}</div>
          <div className="hint">oldest item over {board.thresholds.behind} days, or overdue cards</div>
        </div>
      </div>

      <div className="board-wrap">
        <div className="card board-matrix">
          <div className="board-grid">
            <div className="board-colh">Team member</div>
            {QUEUES.map((q) => (
              <div key={q.key} className="board-colh center">
                {q.icon} {q.label}
              </div>
            ))}
            {board.rows.map((r) => (
              <RowKeys key={r.key} row={r} selected={selected === r.key} onPick={() => setSelected(r.key)} />
            ))}
          </div>
          <div className="board-scale">
            <span>current</span>
            <i className="board-ramp" />
            <span>{board.thresholds.behind}+ days</span>
            <span className="muted" style={{ marginLeft: "auto" }}>
              number = items waiting · small text = oldest · striped = no such queue
            </span>
          </div>
        </div>

        {focus && <FocusPanel row={focus} />}
      </div>
    </>
  );
}

function RowKeys({ row, selected, onPick }: { row: BoardRow; selected: boolean; onPick: () => void }) {
  return (
    <>
      <button className={`board-person${selected ? " on" : ""}`} onClick={onPick}>
        <span className={`board-av${row.shared ? " shared" : ""}`}>{initials(row.name)}</span>
        <span>
          <b>{row.name}</b>
          <small>{row.role}</small>
        </span>
      </button>
      {QUEUES.map((q) => {
        const c = row[q.key];
        if (!c || c.status === "none") {
          return (
            <button key={q.key} className="board-key none" onClick={onPick} aria-pressed={selected} data-q={q.label}>
              <small>{c?.note || "—"}</small>
            </button>
          );
        }
        return (
          <button key={q.key} className={`board-key ${c.status}`} onClick={onPick} aria-pressed={selected} data-q={q.label} title={c.label}>
            <span className="num">{c.new}</span>
            <small>{cellSummary(c)}</small>
          </button>
        );
      })}
    </>
  );
}

function FocusPanel({ row }: { row: BoardRow }) {
  const cells = QUEUES.map((q) => ({ q, c: row[q.key] })).filter((x) => x.c);
  const items = cells
    .flatMap(({ q, c }) => (c!.items || []).map((it) => ({ ...it, src: q.label })))
    .sort((a, b) => b.ageDays - a.ageDays)
    .slice(0, 8);
  const worstDays = row.worstDays;
  return (
    <aside className="card board-focus">
      <div className="board-focus-head">
        <span className={`board-av big${row.shared ? " shared" : ""}`}>{initials(row.name)}</span>
        <div>
          <h2>{row.name}</h2>
          <small>{row.role}</small>
        </div>
        <span className={`board-status ${row.worst}`}>
          {row.worst === "none" ? "no queues" : worstDays > 0 ? `${worstDays} days ${STATUS_WORD[row.worst]}` : STATUS_WORD[row.worst]}
        </span>
      </div>
      <div className="board-stats">
        {QUEUES.map((q) => {
          const c = row[q.key];
          return (
            <div key={q.key}>
              <span className="kicker">{q.label}</span>
              <span className="num">{c && c.status !== "none" ? c.new : "—"}</span>
              <small>{c ? c.note || c.label : "no queue"}</small>
            </div>
          );
        })}
      </div>
      <div className="board-items">
        {items.length === 0 && <div className="muted" style={{ padding: 16 }}>Nothing waiting — all current.</div>}
        {items.map((it, i) => (
          <a key={i} className="board-item" href={it.href || "#"} target={it.href?.startsWith("http") ? "_blank" : undefined} rel="noreferrer">
            <span className={`when ${it.ageDays >= 7 ? "behind" : it.ageDays >= 2 ? "watch" : "current"}`}>{it.ageDays === 0 ? "today" : `${it.ageDays}d`}</span>
            <span className="what">
              <b>{it.title}</b>
              <span>{it.detail}</span>
            </span>
            <span className="src">{it.src}</span>
          </a>
        ))}
      </div>
      <div className="board-actions">
        {row.email && !row.email.note && (
          <Link className="btn small" href={`/board/${row.key}`}>
            Work {row.name}&apos;s inbox
          </Link>
        )}
        {row.tasks && (
          <a className="btn small ghost" href="https://blpstoremap.netlify.app" target="_blank" rel="noreferrer">
            Open task board ↗
          </a>
        )}
        {row.console && row.key === "info" && (
          <Link className="btn small ghost" href="/new-inquiries">
            Work new inquiries
          </Link>
        )}
        {row.console && row.key !== "info" && (
          <Link className="btn small ghost" href={row.key === "brigham" ? "/bl-inbox" : "/inbox"}>
            Open console replies
          </Link>
        )}
      </div>
    </aside>
  );
}

