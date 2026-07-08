"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, getWho } from "@/lib/client";

type ArnoldStatus = {
  tunnelUp: boolean;
  webhookConfigured: boolean;
  claudeFallback: boolean;
  pendingDrafts: number;
  sentToday: number;
  lastDraftAt: string | null;
  queue: number;
};

const SCHEDULE = [
  { time: "8:00 AM", days: "Mon–Sat", what: "Morning sales briefing", where: "BLP Sales Team group" },
  { time: "10:00 AM · 2:00 PM · 5:00 PM", days: "Mon–Sat", what: "Pre-drafting pass (top 8 leads: replies first, then hottest)", where: "Drafts → Approvals" },
  { time: "continuous", days: "", what: "30-day stale sweep hands quiet leads to Arnold; customer text replies ping the group", where: "" },
];

const RESOURCES = [
  { name: "Chat with Arnold (Telegram)", href: "https://t.me/arnoldlarsonbot", note: "ask him anything, assign work conversationally" },
  { name: "Brain health check", href: "https://arnold.brighamlarsonpianos.com/health", note: "should say status: ok — if not, his Mac is asleep" },
  { name: "His approval queue", href: "/approvals", note: "every draft he writes waits here for a human" },
  { name: "His lead queue", href: "/leads?stale=1", note: "stale leads currently assigned to him" },
];

const ON_MAC_FILES = [
  ["Identity & soul", "~/Documents/BLP Knowledge Vault/agents/arnold/ (IDENTITY.md, SOUL.md, MEMORY.md)"],
  ["Knowledge base", "~/Documents/BLP Knowledge Vault/agents/arnold/kb/ (Brigham voice corpus, sales strategy rules)"],
  ["Sales Console contract", "~/Documents/BLP Knowledge Vault/agents/arnold/sales-console-api.md"],
  ["Drafting skill", "~/.hermes/profiles/arnold/skills/business-operations/blp-arnold-sales/"],
];

export default function ArnoldConsole() {
  const [status, setStatus] = useState<ArnoldStatus | null>(null);
  const [error, setError] = useState("");
  const [task, setTask] = useState("");
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<{ kind: "good" | "bad"; text: string } | null>(null);

  useEffect(() => {
    api<ArnoldStatus>("/api/arnold/status").then(setStatus).catch((e) => setError(e.message));
  }, []);

  async function assign(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFlash(null);
    try {
      const r = await api<{ detail: string }>("/api/arnold/task", {
        method: "POST",
        body: JSON.stringify({ task, who: getWho() }),
      });
      setFlash({ kind: "good", text: r.detail });
      setTask("");
    } catch (err) {
      setFlash({ kind: "bad", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  const brainLive = status?.tunnelUp && status?.webhookConfigured;

  return (
    <>
      <div className="page-head" style={{ alignItems: "center" }}>
        <div
          aria-hidden
          style={{
            width: 54, height: 54, borderRadius: 12, background: "var(--crimson)", color: "#fff",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontFamily: "var(--serif)", fontSize: 30, fontWeight: 700,
          }}
        >
          A
        </div>
        <div>
          <h1 style={{ marginBottom: 2 }}>Arnold</h1>
          <div className="muted">Chief Sales Agent · reports to Brigham &amp; Karmel</div>
        </div>
        <span className="spacer" />
        <a className="btn" href="https://t.me/arnoldlarsonbot" target="_blank" rel="noreferrer">Message Arnold</a>
      </div>

      <div className="banner info">
        Lead follow-up, pipeline oversight, and daily pre-drafting — always as a ghostwriter in Brigham&apos;s
        voice, never sending anything without a human&apos;s approval.
      </div>

      {error && <div className="banner bad">⚠ {error}</div>}

      <div className="grid tiles" style={{ marginBottom: 18 }}>
        <div className={`card tile ${status && !brainLive ? "alert" : ""}`}>
          <div className="label">Brain</div>
          <div className="value" style={{ fontSize: 22, marginTop: 10 }}>
            {!status ? "…" : brainLive ? "● Online" : status.tunnelUp ? "◐ Tunnel up" : "○ Unreachable"}
          </div>
          <div className="hint">
            {!status ? "checking the tunnel" : brainLive ? "full Hermes Arnold, via his tunnel" : status.claudeFallback ? "falls back to Claude-as-Arnold" : "Mac asleep or tunnel down"}
          </div>
        </div>
        <Link href="/approvals" className="card tile linky">
          <div className="label">Drafts awaiting approval</div>
          <div className="value">{status?.pendingDrafts ?? "…"}</div>
          <div className="hint">review &amp; send →</div>
        </Link>
        <div className="card tile">
          <div className="label">Sent today (his drafts)</div>
          <div className="value">{status?.sentToday ?? "…"}</div>
          <div className="hint">approved by humans</div>
        </div>
        <Link href="/leads?stale=1" className="card tile linky">
          <div className="label">His lead queue</div>
          <div className="value">{status?.queue ?? "…"}</div>
          <div className="hint">stale leads he&apos;s working →</div>
        </Link>
      </div>

      <div className="two-col">
        <div>
          <div className="card" style={{ marginBottom: 18 }}>
            <h2>Assign Arnold a task</h2>
            <div className="muted" style={{ marginBottom: 10 }}>
              Goes straight to his brain (signed webhook). He&apos;ll do the work and report in the BLP Sales
              Team Telegram group. Pick your name in the sidebar so he knows who&apos;s asking.
            </div>
            {flash && <div className={`banner ${flash.kind}`}>{flash.kind === "good" ? "✓" : "⚠"} {flash.text}</div>}
            <form onSubmit={assign}>
              <textarea
                rows={3}
                placeholder="e.g. Review the 5 hottest restoration leads and draft follow-ups for any without a fresh draft…"
                value={task}
                onChange={(e) => setTask(e.target.value)}
              />
              <button className="btn" style={{ marginTop: 10 }} disabled={busy || !task.trim()}>
                {busy ? "Delivering…" : "Send to Arnold"}
              </button>
            </form>
          </div>

          <div className="card">
            <h2>Schedule</h2>
            <div className="table-wrap" style={{ border: "none" }}>
              <table>
                <tbody>
                  {SCHEDULE.map((s, i) => (
                    <tr key={i} style={{ cursor: "default" }}>
                      <td style={{ whiteSpace: "nowrap" }}><strong>{s.time}</strong><div className="muted">{s.days}</div></td>
                      <td>{s.what}{s.where && <div className="muted">→ {s.where}</div>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="muted" style={{ marginTop: 8 }}>
              Last draft he wrote: {status?.lastDraftAt ? new Date(status.lastDraftAt).toLocaleString() : "—"}
            </div>
          </div>
        </div>

        <div>
          <div className="card" style={{ marginBottom: 18 }}>
            <h2>Boundaries</h2>
            <dl className="kv">
              <dt>Can do</dt>
              <dd>Read the pipeline, draft texts &amp; emails (as Brigham), brief the team, take assigned tasks</dd>
              <dt>Never</dt>
              <dd>Send anything without human approval · identify himself to customers · edit or delete leads · touch pricing/discounts</dd>
              <dt>Voice</dt>
              <dd>Ghostwriter — every customer message speaks and signs as Brigham</dd>
            </dl>
          </div>

          <div className="card" style={{ marginBottom: 18 }}>
            <h2>Links</h2>
            {RESOURCES.map((r) => (
              <div key={r.name} style={{ padding: "7px 0", borderBottom: "1px solid #f0ece6" }}>
                {r.href.startsWith("/") ? (
                  <Link href={r.href} style={{ textDecoration: "underline" }}>{r.name}</Link>
                ) : (
                  <a href={r.href} target="_blank" rel="noreferrer" style={{ textDecoration: "underline" }}>{r.name}</a>
                )}
                <div className="muted">{r.note}</div>
              </div>
            ))}
          </div>

          <div className="card">
            <h2>Mind &amp; memory (on his Mac)</h2>
            <div className="muted" style={{ marginBottom: 8 }}>
              Arnold&apos;s identity, soul, and knowledge live on the shop Mac that runs his brain — they&apos;re
              not on the public internet by design. Paths for whoever sits at that machine:
            </div>
            {ON_MAC_FILES.map(([name, path]) => (
              <div key={name} style={{ padding: "6px 0" }}>
                <strong style={{ fontSize: 13 }}>{name}</strong>
                <div className="muted" style={{ fontFamily: "monospace", fontSize: 11.5, overflowWrap: "anywhere" }}>{path}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
