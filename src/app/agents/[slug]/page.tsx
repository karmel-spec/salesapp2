"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { api, getWho } from "@/lib/client";
import { getAgent } from "@/lib/agents";

/**
 * Agent console template — renders any agent from the registry.
 * Generic sections come from config; live-data widgets are per-agent
 * components keyed by config.widgets.
 */

type ArnoldStatus = {
  tunnelUp: boolean;
  webhookConfigured: boolean;
  claudeFallback: boolean;
  pendingDrafts: number;
  sentToday: number;
  lastDraftAt: string | null;
  queue: number;
};

function ArnoldWidgets() {
  const [status, setStatus] = useState<ArnoldStatus | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api<ArnoldStatus>("/api/arnold/status").then(setStatus).catch((e) => setError(e.message));
  }, []);

  const brainLive = status?.tunnelUp && status?.webhookConfigured;

  return (
    <>
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
    </>
  );
}

function TaskBox({ agentName }: { agentName: string }) {
  const [task, setTask] = useState("");
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<{ kind: "good" | "bad"; text: string } | null>(null);

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

  return (
    <div className="card" style={{ marginBottom: 18 }}>
      <h2>Assign {agentName} a task</h2>
      <div className="muted" style={{ marginBottom: 10 }}>
        Goes straight to his brain (signed webhook). He&apos;ll do the work and report in the BLP Sales Team
        Telegram group. Pick your name in the sidebar so he knows who&apos;s asking.
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
          {busy ? "Delivering…" : `Send to ${agentName}`}
        </button>
      </form>
    </div>
  );
}

export default function AgentConsole({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const agent = getAgent(slug);

  if (!agent) {
    return (
      <div className="banner bad">
        ⚠ No agent named &quot;{slug}&quot; in the registry. <Link href="/agents" style={{ textDecoration: "underline" }}>Back to Agents</Link>
      </div>
    );
  }

  return (
    <>
      <div className="page-head" style={{ alignItems: "center" }}>
        <Link href="/agents" className="muted">← Agents</Link>
        <div
          aria-hidden
          style={{
            width: 54, height: 54, borderRadius: 12, background: agent.accent, color: "#fff",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontFamily: "var(--serif)", fontSize: 30, fontWeight: 700,
          }}
        >
          {agent.name[0]}
        </div>
        <div>
          <h1 style={{ marginBottom: 2 }}>{agent.name}</h1>
          <div className="muted">{agent.role} · reports to {agent.reportsTo}</div>
        </div>
        <span className="spacer" />
        {agent.telegram && (
          <a className="btn" href={agent.telegram} target="_blank" rel="noreferrer">Message {agent.name}</a>
        )}
      </div>

      <div className="banner info">{agent.tagline}</div>

      {agent.status === "coming-soon" && (
        <div className="banner warn">
          🚧 {agent.name} isn&apos;t wired into the console yet — this page is the template we&apos;ll fill in
          when {agent.name} goes live.
        </div>
      )}

      {agent.widgets === "arnold" && <ArnoldWidgets />}

      <div className="two-col">
        <div>
          {agent.widgets === "arnold" && <TaskBox agentName={agent.name} />}

          <div className="card">
            <h2>Schedule</h2>
            {agent.schedule.length === 0 && <div className="muted">No schedule yet.</div>}
            {agent.schedule.length > 0 && (
              <div className="table-wrap" style={{ border: "none" }}>
                <table>
                  <tbody>
                    {agent.schedule.map((s, i) => (
                      <tr key={i} style={{ cursor: "default" }}>
                        <td style={{ whiteSpace: "nowrap" }}>
                          <strong>{s.time}</strong>
                          <div className="muted">{s.days}</div>
                        </td>
                        <td>
                          {s.what}
                          {s.where && <div className="muted">→ {s.where}</div>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        <div>
          <div className="card" style={{ marginBottom: 18 }}>
            <h2>Boundaries</h2>
            <dl className="kv">
              <dt>Can do</dt>
              <dd>{agent.boundaries.can}</dd>
              <dt>Never</dt>
              <dd>{agent.boundaries.never}</dd>
              {agent.boundaries.voice && (
                <>
                  <dt>Voice</dt>
                  <dd>{agent.boundaries.voice}</dd>
                </>
              )}
            </dl>
          </div>

          {agent.links.length > 0 && (
            <div className="card" style={{ marginBottom: 18 }}>
              <h2>Links</h2>
              {agent.links.map((r) => (
                <div key={r.name} style={{ padding: "7px 0", borderBottom: "1px solid #f0ece6" }}>
                  {r.href.startsWith("/") ? (
                    <Link href={r.href} style={{ textDecoration: "underline" }}>{r.name}</Link>
                  ) : (
                    <a href={r.href} target="_blank" rel="noreferrer" style={{ textDecoration: "underline" }}>{r.name}</a>
                  )}
                  {r.note && <div className="muted">{r.note}</div>}
                </div>
              ))}
            </div>
          )}

          {agent.onMacFiles.length > 0 && (
            <div className="card">
              <h2>Mind &amp; memory (on the shop Mac)</h2>
              <div className="muted" style={{ marginBottom: 8 }}>
                Identity, soul, and knowledge live on the machine that runs this agent&apos;s brain — not on
                the public internet, by design.
              </div>
              {agent.onMacFiles.map(([name, path]) => (
                <div key={name} style={{ padding: "6px 0" }}>
                  <strong style={{ fontSize: 13 }}>{name}</strong>
                  <div className="muted" style={{ fontFamily: "monospace", fontSize: 11.5, overflowWrap: "anywhere" }}>{path}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
