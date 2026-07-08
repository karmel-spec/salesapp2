"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";

const NAV = [
  { href: "/", label: "Dashboard", icon: "◆" },
  { href: "/leads", label: "Leads", icon: "♪" },
  { href: "/approvals", label: "Approvals", icon: "✓" },
  { href: "/settings", label: "Settings", icon: "⚙" },
];

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
