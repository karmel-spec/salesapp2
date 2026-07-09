"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/client";
import { AGENTS, DEPARTMENTS, type AgentConfig } from "@/lib/agents";

type HealthDot = "healthy" | "attention" | "offline" | "none";
type AgentHealth = {
  slug: string;
  dot: HealthDot;
  machine: string;
  reportedAt: string;
  fresh: boolean;
  online: boolean | null;
  cronsActive: number;
  cronsOk: number;
  issues: string[];
};
type HealthMap = Record<string, AgentHealth>;

const DOT: Record<HealthDot, { color: string; label: string }> = {
  healthy: { color: "#2e7d46", label: "Healthy" },
  attention: { color: "#c8871a", label: "Needs help" },
  offline: { color: "#b3402e", label: "Offline" },
  none: { color: "#b9b2a7", label: "On deck" },
};

function Dot({ dot, title }: { dot: HealthDot; title?: string }) {
  return (
    <span
      title={title || DOT[dot].label}
      style={{
        display: "inline-block", width: 9, height: 9, borderRadius: "50%",
        background: DOT[dot].color, flexShrink: 0,
      }}
    />
  );
}

function Avatar({ agent, size }: { agent: AgentConfig; size: number }) {
  if (agent.avatar) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={agent.avatar}
        alt={agent.name}
        width={size}
        height={size}
        style={{
          width: size, height: size, borderRadius: 10, objectFit: "cover", flexShrink: 0,
          filter: agent.status === "live" ? "none" : "grayscale(1) opacity(0.75)",
        }}
      />
    );
  }
  return (
    <div
      aria-hidden
      style={{
        width: size, height: size, borderRadius: 10, background: agent.accent, color: "#fff",
        display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
        fontFamily: "var(--serif)", fontSize: size * 0.55, fontWeight: 700,
        filter: agent.status === "live" ? "none" : "grayscale(0.6) opacity(0.8)",
      }}
    >
      {agent.name[0]}
    </div>
  );
}

/** Agent roster — the whole BLP digital team, grouped by department. */
export default function AgentsPage() {
  const [health, setHealth] = useState<HealthMap | null>(null);
  const [healthError, setHealthError] = useState("");

  useEffect(() => {
    api<{ health: HealthMap }>("/api/agents/health")
      .then((r) => setHealth(r.health))
      .catch((e) => setHealthError(e.message));
  }, []);

  const dotFor = (a: AgentConfig): HealthDot => health?.[a.slug]?.dot ?? "none";

  const counts = { healthy: 0, attention: 0, offline: 0, none: 0 };
  for (const a of AGENTS) counts[dotFor(a)]++;

  const attention = AGENTS.filter((a) => dotFor(a) === "attention" || dotFor(a) === "offline");

  return (
    <>
      <div className="page-head">
        <h1>Agents</h1>
        <span className="sub">
          the BLP digital team — {AGENTS.length} agents · grayed portraits go to color as each one is wired up
        </span>
      </div>

      {/* Fleet overview strip */}
      <div className="card" style={{ marginBottom: 18, display: "flex", gap: 18, flexWrap: "wrap", alignItems: "center", padding: "12px 16px" }}>
        {(["healthy", "attention", "offline", "none"] as HealthDot[]).map((d) => (
          <span key={d} style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 14 }}>
            <Dot dot={d} />
            <strong>{health ? counts[d] : "…"}</strong> {DOT[d].label.toLowerCase()}
          </span>
        ))}
        <span className="muted" style={{ fontSize: 12 }}>
          {health
            ? "reported by each agent's machine every 10 minutes"
            : healthError || "checking heartbeats…"}
        </span>
      </div>

      {/* Needs attention */}
      {health && attention.length > 0 && (
        <div className="card" style={{ marginBottom: 18, borderLeft: "3px solid #c8871a" }}>
          <h2>Needs attention</h2>
          {attention.map((a) => {
            const h = health[a.slug];
            return (
              <div key={a.slug} style={{ padding: "7px 0", borderBottom: "1px solid #f0ece6" }}>
                <Link href={`/agents/${a.slug}`} style={{ display: "inline-flex", alignItems: "center", gap: 7, fontWeight: 600, textDecoration: "underline" }}>
                  <Dot dot={h.dot} /> {a.name}
                </Link>
                <ul style={{ margin: "4px 0 0", paddingLeft: 22 }} className="muted">
                  {h.issues.map((issue, i) => (
                    <li key={i}>{issue}</li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}

      {DEPARTMENTS.map((dept) => (
        <section key={dept} style={{ marginBottom: 24 }}>
          <h2>{dept}</h2>
          <div className="grid tiles">
            {AGENTS.filter((a) => a.department === dept).map((a) => {
              const h = health?.[a.slug];
              const d = dotFor(a);
              return (
                <Link key={a.slug} href={`/agents/${a.slug}`} className="card tile linky">
                  <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                    <Avatar agent={a} size={48} />
                    <div style={{ minWidth: 0 }}>
                      <div className="lead-name" style={{ fontSize: 15, display: "flex", alignItems: "center", gap: 7 }}>
                        {a.name}
                        {d !== "none" && (
                          <Dot
                            dot={d}
                            title={h ? `${DOT[d].label} — ${h.cronsOk}/${h.cronsActive} crons ok on ${h.machine}` : undefined}
                          />
                        )}
                      </div>
                      <div className="muted" style={{ fontSize: 12 }}>{a.role}</div>
                    </div>
                  </div>
                  <div style={{ marginTop: 10, display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {d !== "none" ? (
                      <span className={`badge ${d === "healthy" ? "won" : d === "attention" ? "rep" : "lost"}`}>
                        ● {DOT[d].label}
                        {h && h.cronsActive > 0 ? ` · ${h.cronsOk}/${h.cronsActive} crons` : ""}
                      </span>
                    ) : a.status === "live" ? (
                      <span className="badge won">● Live in console</span>
                    ) : (
                      <span className="badge inactive">{a.registryStatus || "On Deck"}</span>
                    )}
                    {a.runtime && <span className="badge rep">{a.runtime.split(" ")[0]}</span>}
                    {a.telegram && a.telegramActive && (
                      <a
                        href={a.telegram}
                        target="_blank"
                        rel="noreferrer"
                        className="badge won"
                        onClick={(e) => e.stopPropagation()}
                        style={{ textDecoration: "none" }}
                      >
                        ✈ Message
                      </a>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      ))}
    </>
  );
}
