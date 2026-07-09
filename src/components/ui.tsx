"use client";

import type { Lead } from "@/lib/leads";

export function StatusBadge({ lead }: { lead: Lead }) {
  const labels: Record<Lead["statusBucket"], string> = {
    new: "New",
    active: "Active",
    snoozed: "💤 Snoozed",
    won: "Won",
    lost: "Lost",
    inactive: "Inactive",
    support: "Support",
    unqualified: "Unqualified",
    closed: "Closed",
  };
  return <span className={`badge ${lead.statusBucket}`}>{labels[lead.statusBucket]}</span>;
}

export function RepBadge({ rep, subRep }: { rep: string; subRep?: string }) {
  if (!rep) return <span className="muted">—</span>;
  return (
    <span className={`badge rep ${rep === "Arnold" ? "arnold" : ""}`}>
      {rep}
      {subRep && <span style={{ opacity: 0.75, fontWeight: 500 }}>&thinsp;+&thinsp;{subRep}</span>}
    </span>
  );
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

/** Render text with bare URLs as clickable links (opens in a new tab). */
export function Linkify({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s)"'<>]+)/g);
  return (
    <>
      {parts.map((part, i) =>
        /^https?:\/\//.test(part) ? (
          <a
            key={i}
            href={part}
            target="_blank"
            rel="noreferrer"
            style={{ textDecoration: "underline", color: "var(--info)", overflowWrap: "anywhere" }}
          >
            {part.length > 64 ? part.slice(0, 61) + "…" : part}
          </a>
        ) : (
          part
        )
      )}
    </>
  );
}
