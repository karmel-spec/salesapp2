"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { useRoster, api } from "@/lib/client";

const NAV = [
  { href: "/leads", label: "Leads" },
  { href: "/bl-inbox", label: "BL Client Responses" },
  { href: "/inbox", label: "Client Responses" },
  { href: "/activity", label: "Activity" },
  { href: "/", label: "Dashboard" },
  { href: "/settings", label: "Settings" },
];

/** The rest of the BLP app family — a collapsible group. Internal routes
 * (href starting with "/") open in-app; the rest open in a new tab. */
const BLP_APPS = [
  { href: "https://blpadmintraining.netlify.app", label: "Admin Training" },
  { href: "https://blpagents.netlify.app", label: "Agent App" },
  { href: "https://blpcrm.netlify.app", label: "CRM" },
  { href: "https://pianologapp.netlify.app", label: "Piano Log App" },
  { href: "https://pianotechnologylibrary.com", label: "PTL" },
  { href: "https://brighamlarsonpianos.tech", label: "Shop App" },
  { href: "https://blpstoremap.netlify.app", label: "Store Map" },
  { href: "https://blpmap.netlify.app", label: "US Marketing Map" },
  { href: "/map", label: "US Sales Map" },
].sort((a, b) => a.label.localeCompare(b.label));

function BlpAppsMenu() {
  const [open, setOpen] = useState(false);
  return (
    <div className="apps-menu">
      <button className="apps-toggle" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span>🎹 BLP Apps</span>
        <span aria-hidden>{open ? "▾" : "▸"}</span>
      </button>
      {open &&
        BLP_APPS.map((a) =>
          a.href.startsWith("/") ? (
            <Link key={a.href} href={a.href} className="apps-link">
              {a.label}
            </Link>
          ) : (
            <a key={a.href} href={a.href} target="_blank" rel="noreferrer" className="apps-link">
              {a.label} <span aria-hidden>↗</span>
            </a>
          )
        )}
    </div>
  );
}

function WhoAmI() {
  const [who, setWho] = useState("");
  const roster = useRoster();
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
      {Array.from(new Set([...roster, ...(who ? [who] : [])])).map((r) => (
        <option key={r} value={r} style={{ color: "#121212" }}>
          {r}
        </option>
      ))}
    </select>
  );
}

/**
 * Unread client responses, polled every 45s and re-checked on navigation so
 * acknowledging in an inbox updates the nav bubbles right away. Split into
 * the two inboxes: direct replies to Brigham's outreach vs everything else.
 */
function useInboxUnread(pathname: string): { brigham: number; others: number } {
  const [counts, setCounts] = useState({ brigham: 0, others: 0 });
  useEffect(() => {
    let dead = false;
    const tick = () =>
      api<{ unread: number; brighamUnread?: number }>("/api/inbox?count=1")
        .then((r) => {
          const brigham = r.brighamUnread ?? 0;
          if (!dead) setCounts({ brigham, others: Math.max(0, r.unread - brigham) });
        })
        .catch(() => {}); // quiet — the bubbles just stay as-is until next poll
    tick();
    const iv = setInterval(tick, 45_000);
    return () => {
      dead = true;
      clearInterval(iv);
    };
  }, [pathname]);
  return counts;
}

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const unread = useInboxUnread(pathname);
  const inboxUnread = unread.brigham + unread.others; // mobile burger total
  const badgeFor = (href: string) =>
    href === "/bl-inbox" ? unread.brigham : href === "/inbox" ? unread.others : 0;

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
          ☰{inboxUnread > 0 && <span className="unread-count">{inboxUnread}</span>}
        </button>
        {drawerOpen && <div className="nav-backdrop" onClick={() => setDrawerOpen(false)} />}
        <nav className={`nav${drawerOpen ? " open" : ""}`}>
          {NAV.map((item) => {
            const active =
              item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            return (
              <Link key={item.href} href={item.href} className={active ? "active" : ""}>
                {item.label}
                {badgeFor(item.href) > 0 && (
                  <span className="count alert" aria-label={`${badgeFor(item.href)} new client responses`}>
                    {badgeFor(item.href)}
                  </span>
                )}
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
    </div>
  );
}
