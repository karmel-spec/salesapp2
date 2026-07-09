"use client";

import Link from "next/link";
import { AGENTS, DEPARTMENTS, type AgentConfig } from "@/lib/agents";

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
  const live = AGENTS.filter((a) => a.status === "live").length;
  return (
    <>
      <div className="page-head">
        <h1>Agents</h1>
        <span className="sub">
          the BLP digital team — {AGENTS.length} agents, {live} live · grayed portraits go to color as each one is wired up
        </span>
      </div>

      {DEPARTMENTS.map((dept) => (
        <section key={dept} style={{ marginBottom: 24 }}>
          <h2>{dept}</h2>
          <div className="grid tiles">
            {AGENTS.filter((a) => a.department === dept).map((a) => (
              <Link key={a.slug} href={`/agents/${a.slug}`} className="card tile linky">
                <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                  <Avatar agent={a} size={48} />
                  <div style={{ minWidth: 0 }}>
                    <div className="lead-name" style={{ fontSize: 15 }}>{a.name}</div>
                    <div className="muted" style={{ fontSize: 12 }}>{a.role}</div>
                  </div>
                </div>
                <div style={{ marginTop: 10, display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {a.status === "live" ? (
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
            ))}
          </div>
        </section>
      ))}
    </>
  );
}
