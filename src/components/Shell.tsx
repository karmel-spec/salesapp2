"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { REPS } from "@/lib/client";

const NAV = [
  { href: "/", label: "Dashboard", icon: "◆" },
  { href: "/leads", label: "Leads", icon: "♪" },
  { href: "/approvals", label: "Approvals", icon: "✓" },
  { href: "/settings", label: "Settings", icon: "⚙" },
];

function WhoAmI() {
  const [who, setWho] = useState("");
  useEffect(() => {
    setWho(localStorage.getItem("blp_rep_name") || "");
  }, []);
  return (
    <select
      aria-label="Who are you?"
      value={who}
      onChange={(e) => {
        setWho(e.target.value);
        localStorage.setItem("blp_rep_name", e.target.value);
      }}
      style={{
        background: "rgba(255,255,255,0.08)",
        color: who ? "#f3efe9" : "rgba(243,239,233,0.55)",
        border: "1px solid rgba(255,255,255,0.18)",
        borderRadius: 8,
        fontSize: 13,
        padding: "6px 8px",
        width: "100%",
      }}
    >
      <option value="">Who are you?</option>
      {REPS.map((r) => (
        <option key={r} value={r} style={{ color: "#121212" }}>
          {r}
        </option>
      ))}
    </select>
  );
}

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (pathname === "/login") return <>{children}</>;

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-name">
            Brigham Larson <em>Pianos</em>
          </div>
          <div className="brand-sub">Sales Console</div>
        </div>
        <nav className="nav">
          {NAV.map((item) => {
            const active =
              item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            return (
              <Link key={item.href} href={item.href} className={active ? "active" : ""}>
                <span aria-hidden>{item.icon}</span>
                {item.label}
              </Link>
            );
          })}
          <div className="who-wrap">
            <WhoAmI />
          </div>
        </nav>
        <div className="sidebar-foot">
          Chief Sales Agent:{" "}
          <a href="https://t.me/arnoldlarsonbot" target="_blank" rel="noreferrer">
            Arnold ↗
          </a>
          <div style={{ marginTop: 4 }}>Leads Log is the source of truth</div>
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
