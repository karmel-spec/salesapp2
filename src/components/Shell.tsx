"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { REPS } from "@/lib/client";

const NAV = [
  { href: "/", label: "Dashboard" },
  { href: "/leads", label: "Leads" },
  { href: "/map", label: "Map" },
  { href: "/approvals", label: "Approvals" },
  { href: "/activity", label: "Activity" },
  { href: "/reports", label: "Reports" },
  { href: "/agents", label: "Agents" },
  { href: "/settings", label: "Settings" },
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
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Navigating (or Esc) closes the mobile drawer.
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDrawerOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen]);

  if (pathname === "/login") return <>{children}</>;

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/blp-logo.png" alt="Brigham Larson Pianos" className="brand-logo" />
          <div className="brand-sub">Sales Console</div>
        </div>
        <button
          className="nav-burger"
          aria-label={drawerOpen ? "Close menu" : "Open menu"}
          aria-expanded={drawerOpen}
          onClick={() => setDrawerOpen((v) => !v)}
        >
          ☰
        </button>
        {drawerOpen && <div className="nav-backdrop" onClick={() => setDrawerOpen(false)} />}
        <nav className={`nav${drawerOpen ? " open" : ""}`}>
          {NAV.map((item) => {
            const active =
              item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            return (
              <Link key={item.href} href={item.href} className={active ? "active" : ""}>
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
          <div style={{ marginTop: 4 }}>
            <a
              href="https://docs.google.com/spreadsheets/d/1sdOeaChihEjAQBCi8U0_lTTlYP4H38eiC6zgmRLoWC0/edit"
              target="_blank"
              rel="noreferrer"
            >
              Leads Log ↗
            </a>{" "}
            is the source of truth
          </div>
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
