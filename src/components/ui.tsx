"use client";

import type { Lead } from "@/lib/leads";

export function StatusBadge({ lead }: { lead: Lead }) {
  const labels: Record<Lead["statusBucket"], string> = {
    new: "New",
    active: "Active",
    won: "Won",
    lost: "Lost",
    inactive: "Inactive",
    support: "Support",
  };
  return <span className={`badge ${lead.statusBucket}`}>{labels[lead.statusBucket]}</span>;
}

export function RepBadge({ rep }: { rep: string }) {
  if (!rep) return <span className="muted">—</span>;
  return <span className={`badge rep ${rep === "Arnold" ? "arnold" : ""}`}>{rep === "Arnold" ? "🤖 Arnold" : rep}</span>;
}

export function StaleBadge({ lead }: { lead: Lead }) {
  if (!lead.isStale) return null;
  return <span className="badge stale">{lead.daysSinceContact}d stale</span>;
}

export function fmtDays(lead: Lead): string {
  if (lead.daysSinceContact === null) return "—";
  if (lead.daysSinceContact === 0) return "today";
  return `${lead.daysSinceContact}d ago`;
}

export function pendingDrafts(lead: Lead) {
  return lead.drafts.filter((d) => d.status === "pending");
}
