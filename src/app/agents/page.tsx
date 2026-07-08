"use client";

import Link from "next/link";
import { AGENTS } from "@/lib/agents";

/** Agent roster — every BLP Hermes agent, live or planned. */
export default function AgentsPage() {
  return (
    <>
      <div className="page-head">
        <h1>Agents</h1>
        <span className="sub">the BLP digital team — each with a console, a schedule, and hard boundaries</span>
      </div>

      <div className="grid tiles">
        {AGENTS.map((a) => (
          <Link key={a.slug} href={`/agents/${a.slug}`} className="card tile linky" style={{ opacity: a.status === "live" ? 1 : 0.65 }}>
            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
              <div
                aria-hidden
                style={{
                  width: 44, height: 44, borderRadius: 10, background: a.accent, color: "#fff",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontFamily: "var(--serif)", fontSize: 24, fontWeight: 700, flexShrink: 0,
                }}
              >
                {a.name[0]}
              </div>
              <div>
                <div className="lead-name" style={{ fontSize: 16 }}>{a.name}</div>
                <div className="muted">{a.role}</div>
              </div>
            </div>
            <div className="hint" style={{ marginTop: 10 }}>{a.tagline}</div>
            <div style={{ marginTop: 8 }}>
              <span className={`badge ${a.status === "live" ? "won" : "inactive"}`}>
                {a.status === "live" ? "● Live" : "Coming soon"}
              </span>
            </div>
          </Link>
        ))}
      </div>
    </>
  );
}
