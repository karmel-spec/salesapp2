"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { api, getWho } from "@/lib/client";
import type { ThreadSummary, ThreadDetail } from "@/lib/gmail";

/**
 * A team member's Gmail inbox, worked from inside the console: thread list
 * on the left, the open conversation and a reply box on the right. Replies
 * go out as the mailbox owner; read/unread/archive change the real inbox.
 */
export function Mailbox({ person }: { person: string }) {
  const [name, setName] = useState("");
  const [user, setUser] = useState("");
  const [threads, setThreads] = useState<ThreadSummary[] | null>(null);
  const [next, setNext] = useState<string | undefined>();
  const [error, setError] = useState<{ text: string; status?: number } | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [thread, setThread] = useState<ThreadDetail | null>(null);
  const [loadingThread, setLoadingThread] = useState(false);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [flash, setFlash] = useState("");
  const [unreadOnly, setUnreadOnly] = useState(true);
  const [busy, setBusy] = useState(false);
  const replyRef = useRef<HTMLTextAreaElement>(null);

  const load = (pageToken = "", append = false) =>
    api<{ user: string; name: string; threads: ThreadSummary[]; nextPageToken?: string }>(
      `/api/mail/${encodeURIComponent(person)}${pageToken ? `?page=${encodeURIComponent(pageToken)}` : ""}`
    )
      .then((r) => {
        setUser(r.user);
        setName(r.name);
        setThreads((cur) => (append && cur ? [...cur, ...r.threads] : r.threads));
        setNext(r.nextPageToken);
        setError(null);
      })
      .catch((e: Error & { status?: number }) => setError({ text: e.message }));

  useEffect(() => {
    setThreads(null);
    setOpenId(null);
    setThread(null);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [person]);

  const open = (id: string) => {
    setOpenId(id);
    setThread(null);
    setLoadingThread(true);
    setReply("");
    api<ThreadDetail>(`/api/mail/${encodeURIComponent(person)}/${encodeURIComponent(id)}`)
      .then((t) => {
        setThread(t);
        // Opening marks it read on the server; mirror that in the list.
        setThreads((cur) => cur?.map((x) => (x.id === id ? { ...x, unread: false } : x)) || cur);
      })
      .catch((e) => setFlash(`⚠ ${e.message}`))
      .finally(() => setLoadingThread(false));
  };

  const act = async (action: "read" | "unread" | "archive", ids: string[]) => {
    if (!ids.length) return;
    setBusy(true);
    try {
      await api(`/api/mail/${encodeURIComponent(person)}`, { method: "POST", body: JSON.stringify({ action, threadIds: ids }) });
      setThreads((cur) =>
        cur
          ? action === "archive"
            ? cur.filter((t) => !ids.includes(t.id))
            : cur.map((t) => (ids.includes(t.id) ? { ...t, unread: action === "unread" } : t))
          : cur
      );
      if (action === "archive" && openId && ids.includes(openId)) {
        setOpenId(null);
        setThread(null);
      }
      setFlash(action === "archive" ? `Archived ${ids.length}` : action === "read" ? "Marked read" : "Marked unread");
      setTimeout(() => setFlash(""), 3000);
    } catch (e) {
      setFlash(`⚠ ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(false);
    }
  };

  const send = async () => {
    if (!openId || !reply.trim()) return;
    setSending(true);
    try {
      const r = await api<{ ok: boolean; dryRun?: boolean; to: string }>(`/api/mail/${encodeURIComponent(person)}/${encodeURIComponent(openId)}`, {
        method: "POST",
        body: JSON.stringify({ body: reply.trim(), who: getWho() }),
      });
      setFlash(r.dryRun ? `Dry run — would have replied to ${r.to} as ${name}` : `Replied to ${r.to} as ${name}`);
      setReply("");
      open(openId);
      setTimeout(() => setFlash(""), 5000);
    } catch (e) {
      setFlash(`⚠ ${e instanceof Error ? e.message : e}`);
    } finally {
      setSending(false);
    }
  };

  if (error) {
    return (
      <>
        <div className="page-head">
          <h1>{person.charAt(0).toUpperCase() + person.slice(1)}&apos;s email</h1>
          <span className="spacer" />
          <Link href={`/board/${person}`} className="btn ghost small">← Inbox Board</Link>
        </div>
        <div className="banner warn">⚠ {error.text}</div>
      </>
    );
  }

  const unread = threads?.filter((t) => t.unread).length ?? 0;
  const shown = threads ? (unreadOnly ? threads.filter((t) => t.unread) : threads) : [];

  return (
    <>
      <div className="page-head">
        <h1>{name || "…"}&apos;s email</h1>
        <span className="sub">
          {user}
          {threads ? ` · ${unread} unread in the newest ${threads.length}` : ""} — anyone on the team can work this inbox; replies go out as {name || "them"}
        </span>
        <span className="spacer" />
        <Link href="/board" className="btn ghost small">Inbox Board</Link>
        <button className="btn ghost small" onClick={() => load()} disabled={busy}>↻ Refresh</button>
        {user && (
          <a
            className="btn small"
            href={`https://mail.google.com/mail/b/${encodeURIComponent(user)}/#inbox`}
            target="_blank"
            rel="noreferrer"
            title={`Opens ${name}'s full Gmail as a delegate — requires ${name} to have granted you access (Gmail → Settings → Accounts → Grant access)`}
          >
            Open in Gmail as delegate ↗
          </a>
        )}
      </div>

      {flash && <div className="banner info">{flash}</div>}

      <div className="mail-split">
        <div className="card mail-list">
          <div className="mail-toolbar">
            <button className={`folder-chip${unreadOnly ? " active" : ""}`} onClick={() => setUnreadOnly(true)}>Unread{unread ? ` (${unread})` : ""}</button>
            <button className={`folder-chip${!unreadOnly ? " active" : ""}`} onClick={() => setUnreadOnly(false)}>All</button>
            <span style={{ flex: 1 }} />
            {unread > 0 && (
              <button className="btn small ghost" disabled={busy} onClick={() => act("read", (threads || []).filter((t) => t.unread).map((t) => t.id))}>
                ✓ Mark {unread} read
              </button>
            )}
          </div>
          {!threads && <div className="spin">Opening {name || "the"} inbox…</div>}
          {threads && shown.length === 0 && <div className="muted" style={{ padding: 16 }}>{unreadOnly ? "Nothing unread in this page of the inbox." : "Inbox is empty."}</div>}
          {shown.map((t) => (
            <div key={t.id} className={`mail-row${t.unread ? " unread" : ""}${openId === t.id ? " open" : ""}`} onClick={() => open(t.id)}>
              <div className="mail-row-top">
                <span className="mail-from">{t.from}</span>
                <span className="mail-date">{fmtDate(t.date)}</span>
              </div>
              <div className="mail-subject">
                {t.subject}
                {t.count > 1 && <span className="mail-count">{t.count}</span>}
              </div>
              <div className="mail-snippet">{t.snippet}</div>
              <div className="mail-row-actions" onClick={(e) => e.stopPropagation()}>
                <button className="btn small ghost" disabled={busy} onClick={() => act(t.unread ? "read" : "unread", [t.id])}>{t.unread ? "Mark read" : "Mark unread"}</button>
                <button className="btn small ghost" disabled={busy} onClick={() => act("archive", [t.id])}>Archive</button>
              </div>
            </div>
          ))}
          {threads && next && (
            <button className="btn ghost small" style={{ margin: 12 }} onClick={() => load(next, true)}>
              Load older threads
            </button>
          )}
        </div>

        <div className="card mail-reader">
          {!openId && <div className="muted" style={{ padding: 24 }}>Pick a conversation to read it here. Opening one marks it read for {name || "them"} too.</div>}
          {openId && loadingThread && <div className="spin">Loading conversation…</div>}
          {thread && (
            <>
              <div className="mail-reader-head">
                <h2>{thread.subject}</h2>
                <div className="mail-reader-actions">
                  <button className="btn small ghost" disabled={busy} onClick={() => act("unread", [thread.id])}>Mark unread</button>
                  <button className="btn small ghost" disabled={busy} onClick={() => act("archive", [thread.id])}>Archive</button>
                  <a className="btn small ghost" href={`https://mail.google.com/mail/u/?authuser=${encodeURIComponent(user)}#inbox/${thread.id}`} target="_blank" rel="noreferrer">Gmail ↗</a>
                </div>
              </div>
              {thread.messages.map((m) => (
                <div key={m.id} className={`mail-msg${m.fromAddress.toLowerCase() === user.toLowerCase() ? " ours" : ""}`}>
                  <div className="mail-msg-head">
                    <b>{m.from}</b> <span className="muted">&lt;{m.fromAddress}&gt; · {fmtDate(m.date, true)}</span>
                  </div>
                  <pre className="mail-body">{m.body || "(no text in this message)"}</pre>
                </div>
              ))}
              <div className="mail-reply">
                <label className="muted" style={{ fontSize: 12.5 }}>
                  Reply as <b>{name}</b> ({user}) — signed “{getWho() !== "app" ? getWho() : name}, Brigham Larson Pianos”
                </label>
                <textarea ref={replyRef} rows={5} value={reply} onChange={(e) => setReply(e.target.value)} placeholder={`Write ${name}'s reply…`} />
                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                  <button className="btn" disabled={sending || !reply.trim()} onClick={send}>
                    {sending ? "Sending…" : `Send as ${name}`}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}

function fmtDate(iso: string, withTime = false): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const sameYear = d.getFullYear() === new Date().getFullYear();
  const day = d.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) });
  return withTime ? `${day} · ${d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : day;
}
