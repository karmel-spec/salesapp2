"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { REPS, api } from "@/lib/client";

const NAV = [
  { href: "/", label: "Dashboard" },
  { href: "/leads", label: "Leads" },
  { href: "/map", label: "US Sales Map" },
  { href: "/approvals", label: "Approvals" },
  { href: "/activity", label: "Activity" },
  { href: "/reports", label: "Reports" },
  { href: "/agents", label: "Agents" },
  { href: "/settings", label: "Settings" },
];

/** The rest of the BLP app family — external links in a collapsible group. */
const BLP_APPS = [
  { href: "https://brighamlarsonpianos.tech", label: "Shop App" },
  { href: "https://blpcrm.netlify.app", label: "CRM" },
  { href: "https://blpstoremap.netlify.app", label: "Store Map" },
  { href: "https://blpmap.netlify.app", label: "US Marketing Map" },
  { href: "https://pianologapp.netlify.app", label: "Piano Log App" },
  { href: "https://pianotechnologylibrary.com", label: "PTL" },
  { href: "https://brighamlarsonpianos.org", label: "Operations" },
];

function BlpAppsMenu() {
  const [open, setOpen] = useState(false);
  return (
    <div className="apps-menu">
      <button className="apps-toggle" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span>🎹 BLP Apps</span>
        <span aria-hidden>{open ? "▾" : "▸"}</span>
      </button>
      {open &&
        BLP_APPS.map((a) => (
          <a key={a.href} href={a.href} target="_blank" rel="noreferrer" className="apps-link">
            {a.label} <span aria-hidden>↗</span>
          </a>
        ))}
    </div>
  );
}

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

/**
 * Always-visible "New Client Responses" alert. Sits fixed in the top-right
 * corner on every page, polls the inbox, and deep-links to the Activity
 * inbox. Hidden when everything has been acknowledged.
 */
function InboxAlert() {
  const pathname = usePathname();
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    let dead = false;
    const tick = () =>
      api<{ unread: number }>("/api/inbox?count=1")
        .then((r) => {
          if (!dead) setUnread(r.unread);
        })
        .catch(() => {}); // quiet — the pill just stays as-is until next poll
    tick();
    const iv = setInterval(tick, 45_000);
    return () => {
      dead = true;
      clearInterval(iv);
    };
    // Re-check on navigation so acknowledging in Activity updates the pill fast.
  }, [pathname]);

  if (!unread) return null;
  return (
    <Link href="/activity?filter=inbound" className="inbox-alert" aria-live="polite">
      📥 {unread} New Client Response{unread === 1 ? "" : "s"}
    </Link>
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
          <BlpAppsMenu />
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
      <InboxAlert />
    </div>
  );
}
