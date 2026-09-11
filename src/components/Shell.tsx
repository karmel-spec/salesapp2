"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { useRoster, api } from "@/lib/client";
import { GlobalSearch } from "@/components/GlobalSearch";

const NAV: { href: string; label: string; sub?: boolean; boardKey?: string }[] = [
  { href: "/bl-inbox", label: "BL Client Responses" },
  { href: "/bl-leads", label: "BL Leads" },
  { href: "/leads", label: "Leads" },
  { href: "/inbox", label: "Client Responses" },
  // New Inquiries splits into three sub-inboxes whose counts add up to it.
  { href: "/new-inquiries", label: "New Inquiries" },
  { href: "/new-inquiries/tuning", label: "Tuning", sub: true },
  { href: "/new-inquiries/moving", label: "Moving", sub: true },
  { href: "/customer-service", label: "Customer Service", sub: true },
  { href: "/board", label: "Inbox Board" },
  // Per-person rows: unread/total email on the left, open task cards on the right.
  { href: "/board/brigham", label: "Brigham", sub: true, boardKey: "brigham" },
  { href: "/board/karmel", label: "Karmel", sub: true, boardKey: "karmel" },
  { href: "/board/alisa", label: "Alisa", sub: true, boardKey: "alisa" },
  { href: "/board/melissa", label: "Melissa", sub: true, boardKey: "melissa" },
  { href: "/board/lisa", label: "Lisa", sub: true, boardKey: "lisa" },
  { href: "/board/info", label: "Info", sub: true, boardKey: "info" },
  { href: "/board/blp", label: "BLP", sub: true, boardKey: "blp" },
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

/**
 * BLP Apps: a flyout panel that opens beside the sidebar (desktop) so the
 * full app list never has to fit inside the nav's height; inside the phone
 * drawer it renders inline, where the drawer scrolls.
 */
function BlpAppsMenu() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  const host = (href: string) => {
    try {
      return new URL(href).hostname.replace(/^www\./, "");
    } catch {
      return "";
    }
  };
  return (
    <div className="apps-menu">
      <button className="apps-toggle" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-haspopup="true">
        <span>🎹 BLP Apps</span>
        <span aria-hidden>{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <>
          <div className="apps-backdrop" onClick={() => setOpen(false)} />
          <div className="apps-flyout" role="menu" aria-label="BLP apps">
            <div className="apps-flyout-head">
              <span>BLP apps</span>
              <span className="muted-light">↗ opens in a new tab</span>
            </div>
            <div className="apps-grid">
              {BLP_APPS.map((a) =>
                a.href.startsWith("/") ? (
                  <Link key={a.href} href={a.href} className="apps-tile" role="menuitem" onClick={() => setOpen(false)}>
                    <b>{a.label}</b>
                    <small>in the console</small>
                  </Link>
                ) : (
                  <a key={a.href} href={a.href} target="_blank" rel="noreferrer" className="apps-tile" role="menuitem" onClick={() => setOpen(false)}>
                    <b>{a.label} <span aria-hidden>↗</span></b>
                    <small>{host(a.href)}</small>
                  </a>
                )
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * "+ New lead" — lives in the sidebar so it's one click from any page. Opens
 * the new-lead form on the signed-in person's Leads tab (BL Leads for
 * Brigham, Leads for everyone else) via ?new=1.
 */
function NewLeadButton({ className }: { className: string }) {
  const [who, setWho] = useState("");
  const pathname = usePathname();
  useEffect(() => {
    setWho(localStorage.getItem("blp_rep_name") || "");
  }, [pathname]);
  const target = who === "Brigham" ? "/bl-leads" : "/leads";
  return (
    <Link
      href={`${target}?new=1`}
      className={className}
      onClick={(e) => {
        // Already on that tab: the page won't remount, so tell it directly.
        if (pathname === target) {
          e.preventDefault();
          window.dispatchEvent(new CustomEvent("blp:new-lead"));
        }
      }}
    >
      + New lead
    </Link>
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
type InboxCounts = {
  brigham: number; fresh: number; others: number;
  newFolders: Record<string, number>;
  readClients: Record<string, number>; // clients in each page's "Read" section
};
function useInboxUnread(pathname: string): InboxCounts {
  const [counts, setCounts] = useState<InboxCounts>({ brigham: 0, fresh: 0, others: 0, newFolders: {}, readClients: {} });
  useEffect(() => {
    let dead = false;
    const tick = () =>
      api<{ unread: number; brighamUnread?: number; newUnread?: number; newFolders?: Record<string, number>; readClients?: Record<string, number> }>("/api/inbox?count=1")
        .then((r) => {
          const brigham = r.brighamUnread ?? 0;
          const fresh = r.newUnread ?? 0;
          if (!dead) setCounts({
            brigham, fresh, others: Math.max(0, r.unread - brigham - fresh), newFolders: r.newFolders || {},
            readClients: r.readClients || {},
          });
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

/** Active-lead counts for the two Leads tabs (Brigham's vs everyone else's). */
function useLeadCounts(pathname: string): { brigham: number; others: number; support: number } {
  const [counts, setCounts] = useState({ brigham: 0, others: 0, support: 0 });
  useEffect(() => {
    let dead = false;
    const tick = () =>
      api<{ brighamActive: number; othersActive: number; support?: number }>("/api/leads?count=1")
        .then((r) => {
          if (!dead) setCounts({ brigham: r.brighamActive, others: r.othersActive, support: r.support ?? 0 });
        })
        .catch(() => {});
    tick();
    const iv = setInterval(tick, 60_000);
    return () => {
      dead = true;
      clearInterval(iv);
    };
  }, [pathname]);
  return counts;
}

/** Team Inbox Board totals: unread email overall, plus per-person email and task-card numbers. */
type BoardPerson = { key: string; name: string; taskOwner?: string; emailUnread: number | null; emailTotal: number | null; cards: number | null; askBrigham?: number | null };
function useBoardTotals(pathname: string): { emailUnread: number; emailTotal: number; people: Record<string, BoardPerson> } {
  const [n, setN] = useState<{ emailUnread: number; emailTotal: number; people: Record<string, BoardPerson> }>({ emailUnread: 0, emailTotal: 0, people: {} });
  useEffect(() => {
    let dead = false;
    const tick = () =>
      api<{ emailUnread: number; emailTotal?: number; people?: BoardPerson[] }>("/api/board?count=1")
        .then((r) => {
          if (!dead) setN({ emailUnread: r.emailUnread, emailTotal: r.emailTotal ?? 0, people: Object.fromEntries((r.people || []).map((p) => [p.key, p])) });
        })
        .catch(() => {});
    tick();
    const iv = setInterval(tick, 120_000);
    return () => {
      dead = true;
      clearInterval(iv);
    };
  }, [pathname]);
  return n;
}

/** Plaud call recordings still waiting to be filed to a lead (Dashboard bubble). */
function useUnfiledCalls(pathname: string): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    let dead = false;
    const tick = () =>
      api<{ items: unknown[] }>("/api/plaud/unfiled")
        .then((r) => {
          if (!dead) setN(r.items.length);
        })
        .catch(() => {});
    tick();
    const iv = setInterval(tick, 90_000);
    return () => {
      dead = true;
      clearInterval(iv);
    };
  }, [pathname]);
  return n;
}

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const unread = useInboxUnread(pathname);
  const leadCounts = useLeadCounts(pathname);
  const unfiledCalls = useUnfiledCalls(pathname);
  const boardTotals = useBoardTotals(pathname);
  const boardEmail = boardTotals.emailUnread;
  const inboxUnread = unread.brigham + unread.fresh + unread.others; // mobile burger total
  // Crimson "alert" bubbles = messages awaiting a reply; plain bubbles = lead counts.
  // Inbox bubbles read "unread/read": unread messages / clients in that page's Read
  // section (awaiting a reply, or history).
  const rc = unread.readClients;
  const badgeFor = (href: string): { n: number; alert: boolean; awaiting?: number } => {
    switch (href) {
      case "/bl-inbox": return { n: unread.brigham, alert: true, awaiting: rc.brigham ?? 0 };
      case "/new-inquiries": return { n: unread.fresh, alert: true, awaiting: rc.new ?? 0 };
      case "/new-inquiries/tuning": return { n: unread.newFolders.tuning || 0, alert: true, awaiting: rc["new:tuning"] ?? 0 };
      case "/new-inquiries/moving": return { n: unread.newFolders.moving || 0, alert: true, awaiting: rc["new:moving"] ?? 0 };
      case "/inbox": return { n: unread.others, alert: true, awaiting: rc.others ?? 0 };
      case "/bl-leads": return { n: leadCounts.brigham, alert: false };
      case "/leads": return { n: leadCounts.others, alert: false };
      // Everything in New Inquiries that isn't Tuning or Moving — the sorting queue.
      case "/customer-service":
        return { n: Math.max(0, unread.fresh - (unread.newFolders.tuning || 0) - (unread.newFolders.moving || 0)), alert: true, awaiting: rc["new:other"] ?? 0 };
      case "/": return { n: unfiledCalls, alert: true }; // unfiled call recordings
      case "/board": return { n: boardEmail, alert: false, awaiting: boardTotals.emailTotal }; // unread / in inbox, all mailboxes
      default: return { n: 0, alert: false };
    }
  };

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
          <NewLeadButton className="btn new-lead-btn" />
          {/* Global search: every lead, every field, as you type. */}
          <GlobalSearch className="brand-search" />
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
          {/* Phones: the brand area is a slim top bar, so the button lives in the drawer instead. */}
          <NewLeadButton className="btn new-lead-btn drawer-only" />
          <GlobalSearch className="drawer-only" />
          {NAV.map((item) => {
            const active =
              item.href === "/" ? pathname === "/" : pathname === item.href || pathname.startsWith(item.href + "/");
            if (item.boardKey) {
              const p = boardTotals.people[item.boardKey];
              const mail = p && p.emailUnread !== null ? `${p.emailUnread}/${p.emailTotal}` : "—";
              const ask = p?.askBrigham ?? 0;
              const isBrigham = item.boardKey === "brigham";
              // Deep link into the Store Map on that person's task board.
              const boardHref = p?.taskOwner ? `https://blpstoremap.netlify.app/#board=${encodeURIComponent(p.taskOwner)}` : "";
              return (
                <div key={item.href} className={`nav-row sub${active ? " active" : ""}`}>
                  <Link href={item.href} className="nav-row-main" title={`Open ${item.label}'s email`}>
                    <span className="count left mail" title={p && p.emailUnread !== null ? `${p.emailUnread} unread of ${p.emailTotal} emails in inbox` : "mailbox not connected yet"}>{mail}</span>
                    {item.label}
                  </Link>
                  {p && p.cards !== null && boardHref ? (
                    <a
                      className="postit"
                      href={boardHref}
                      target="_blank"
                      rel="noreferrer"
                      title={`Open ${item.label}'s task board in the Store Map — ${isBrigham ? `${p.cards} open cards` : `${p.cards - ask} task cards / ${ask} questions for Brigham`}`}
                    >
                      {isBrigham ? p.cards : `${p.cards - ask}/${ask}`}
                    </a>
                  ) : (
                    <span className="postit empty" title="no Store Map task board">—</span>
                  )}
                </div>
              );
            }
            return (
              <Link key={item.href} href={item.href} className={`${active ? "active" : ""}${item.sub ? " sub" : ""}`}>
                {/* Sub-items show the count on the LEFT so the three add up visibly to the parent. */}
                {item.sub && !item.boardKey && (
                  <span
                    className={`count left${badgeFor(item.href).alert ? " alert" : ""}`}
                    title={badgeFor(item.href).awaiting !== undefined ? `${badgeFor(item.href).n} unread messages / ${badgeFor(item.href).awaiting} clients read — awaiting a reply, or history` : undefined}
                  >
                    {badgeFor(item.href).n}
                    {badgeFor(item.href).awaiting !== undefined && <span className="awaiting">/{badgeFor(item.href).awaiting}</span>}
                  </span>
                )}
                {item.label}
                {!item.sub && (badgeFor(item.href).n > 0 || (badgeFor(item.href).awaiting ?? 0) > 0) && (
                  <span
                    className={badgeFor(item.href).alert ? "count alert" : "count"}
                    title={badgeFor(item.href).awaiting !== undefined ? `${badgeFor(item.href).n} unread messages / ${badgeFor(item.href).awaiting} clients read — awaiting a reply, or history` : undefined}
                  >
                    {badgeFor(item.href).n}
                    {badgeFor(item.href).awaiting !== undefined && <span className="awaiting">/{badgeFor(item.href).awaiting}</span>}
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
        {/* The helper dock (#blp-dock: assistant faces + 💡) is created in
            layout.tsx outside React's tree and pinned over this footer area
            by CSS — widgets inject into it before hydration, so it can't be
            React-managed. */}
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
