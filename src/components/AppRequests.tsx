"use client";

import { useEffect, useMemo, useState } from "react";
import { api, getWho } from "@/lib/client";
import type { AppRequest } from "@/lib/app-requests";

/**
 * Dashboard → 💡 App Requests (Brigham 10/30): manage the Sales App's own
 * lightbulb requests here instead of in the Store Map. Mirrors the Store
 * Map's App Requests panel — Open / Live / Tested / All, search, In progress /
 * Live / Tested buttons, the "more…" statuses and Copy for Claude. Always
 * mounted by the Dashboard so the tab badge knows the open count.
 */

const ICON: Record<string, string> = { bug: "🐛", edit: "✏️", idea: "💡" };
const CLOSED = new Set(["Live", "Tested", "Declined", "Duplicate", "Resolved", "Archived"]);
const MORE = ["Requested", "Texted for info", "Resolved", "Archived", "Declined", "Duplicate"];
type Filter = "open" | "Live" | "Tested" | "all";

const isOpen = (r: AppRequest) => !CLOSED.has(r.status);

function brief(x: AppRequest): string {
  return (
    `App request ${x.id} — Sales App (${x.type || "edit"}) from ${x.who}, ${String(x.at).slice(0, 10)}:\n"${x.text}"` +
    `\nContext: ${x.context || "—"}${x.screenshot ? `\nScreenshot: ${x.screenshot}` : ""}\nStatus: ${x.status}` +
    `\nApp URL: ${typeof window !== "undefined" ? window.location.origin : ""}` +
    `\nWhen it ships: set ${x.id} to Live from Dashboard → 💡 App Requests (texts the requester).`
  );
}

export function AppRequests({ onCount, active }: { onCount?: (n: number) => void; active?: boolean }) {
  const [reqs, setReqs] = useState<AppRequest[] | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<Filter>("open");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string>(""); // id being updated
  const [toast, setToast] = useState("");
  const [copied, setCopied] = useState("");

  const load = () =>
    api<{ requests: AppRequest[] }>("/api/requests")
      .then((r) => {
        setReqs(r.requests);
        setError("");
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));

  useEffect(() => {
    load();
    // The 💡 widget tells us when it files a new one; refresh so it shows up at once.
    const onFiled = () => load();
    window.addEventListener("blp:request-filed", onFiled);
    return () => window.removeEventListener("blp:request-filed", onFiled);
  }, []);

  // Re-check when the tab is opened (statuses may have moved from a phone).
  useEffect(() => {
    if (active) load();
  }, [active]);

  useEffect(() => {
    onCount?.(reqs ? reqs.filter(isOpen).length : 0);
  }, [reqs, onCount]);

  const hits = useMemo(() => {
    if (!reqs) return [];
    const needle = q.trim().toLowerCase();
    return reqs.filter((r) => {
      const stOk = filter === "open" ? isOpen(r) : filter === "all" ? true : r.status === filter;
      if (!stOk) return false;
      if (!needle) return true;
      return `${r.who} ${r.type} ${r.id} ${r.text} ${r.context} ${r.status}`.toLowerCase().includes(needle);
    });
  }, [reqs, filter, q]);

  function flash(t: string) {
    setToast(t);
    window.setTimeout(() => setToast(""), 3200);
  }

  async function setStatus(id: string, status: string) {
    setBusy(id);
    try {
      const r = await api<{ request: AppRequest; texted: boolean }>("/api/requests", {
        method: "PATCH",
        // "Who are you?" when picked; otherwise the server uses the Google session name.
        body: JSON.stringify({ id, status, who: getWho() === "app" ? "" : getWho() }),
      });
      setReqs((cur) => (cur || []).map((x) => (x.id === id ? r.request : x)));
      flash(r.texted ? `✓ Live — ${r.request.who.split(" ")[0]} has been texted` : `✓ ${id} → ${status}`);
    } catch (e) {
      flash(`✗ ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy("");
    }
  }

  async function copy(x: AppRequest) {
    try {
      await navigator.clipboard.writeText(brief(x));
      setCopied(x.id);
    } catch {
      flash("✗ copy blocked by the browser");
    }
    window.setTimeout(() => setCopied(""), 1500);
  }

  const openCount = reqs ? reqs.filter(isOpen).length : 0;

  return (
    <div>
      <div className="reqs-bar">
        {(["open", "Live", "Tested", "all"] as Filter[]).map((f) => (
          <button key={f} className={`btn small${filter === f ? "" : " ghost"}`} onClick={() => setFilter(f)}>
            {f === "open" ? `Open${openCount ? ` (${openCount})` : ""}` : f === "all" ? "All" : f}
          </button>
        ))}
        <input className="search" placeholder="🔍 words, name, or request id…" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn ghost small" onClick={load} title="reload">🔄</button>
        {reqs && <span className="reqs-sub">{openCount} open · {reqs.length} total</span>}
      </div>

      {toast && <div className={`banner ${toast.startsWith("✗") ? "bad" : "good"}`}>{toast}</div>}
      {error && <div className="banner bad">⚠ {error}</div>}

      {!reqs && !error && <div className="spin">Loading requests…</div>}
      {reqs && !hits.length && (
        <div className="req-empty">
          {filter === "open" && !q ? "Nothing open for the Sales App. 🎉 Team members file new ones from the 💡 in the sidebar." : "No requests match."}
        </div>
      )}

      {hits.map((r) => {
        const cur = r.status || "Requested";
        const stBtn = (st: string, label: string) => (
          <button
            key={st}
            className={`btn small ghost${cur === st ? " cur" : ""}`}
            disabled={cur === st || busy === r.id}
            onClick={() => setStatus(r.id, st)}
          >
            {label}
          </button>
        );
        return (
          <div className="req-card" key={r.id}>
            <div className="req-top">
              <b>{r.who}</b>
              <span className={`req-chip ${r.type}`}>{ICON[r.type] || "💡"} {r.type || "edit"}</span>
              <span className={`req-st s${cur.replace(/\s/g, "")}`}>{cur}</span>
              <small>
                {String(r.at).slice(0, 10)} · {r.id}
              </small>
            </div>
            <div className="req-text">{r.text}</div>
            <div className="req-meta">
              {r.context}
              {r.screenshot && (
                <>
                  {" · "}
                  <a href={r.screenshot} target="_blank" rel="noopener noreferrer">📎 screenshot ↗</a>
                </>
              )}
              {r.statusBy && ` · ${cur} by ${r.statusBy}${r.statusAt ? ` on ${String(r.statusAt).slice(0, 10)}` : ""}`}
            </div>
            <div className="req-btns">
              {stBtn("In progress", "🔧 In progress")}
              {stBtn("Live", "🚀 Live")}
              {stBtn("Tested", "✅ Tested")}
              <select
                value=""
                disabled={busy === r.id}
                title="other statuses"
                onChange={(e) => {
                  if (e.target.value) setStatus(r.id, e.target.value);
                }}
              >
                <option value="">more…</option>
                {MORE.filter((s) => s !== cur).map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
              <button className="btn small ghost copy" onClick={() => copy(r)}>
                {copied === r.id ? "✓ copied" : "📋 Copy for Claude"}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
