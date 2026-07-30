"use client";

import { useEffect, useState } from "react";
import type { Lead, LeadBrief } from "@/lib/leads";
import type { LeadGeo } from "@/lib/geo-shared";
import { api } from "@/lib/client";

/**
 * The Ledger Card — the at-a-glance client summary at the top of a lead:
 * facts ledger on the left, Arnold's briefing (where we left off → next
 * action) on the right. The briefing is cached on the lead and refreshed
 * by the server only when the conversation has moved.
 */

function responsiveness(lead: Lead): { label: string; good: boolean } {
  const inbound = lead.timeline.filter((e) => e.kind === "inbound");
  if (!inbound.length) return { label: "no replies yet", good: false };
  const lastEvent = lead.timeline[lead.timeline.length - 1];
  if (lastEvent?.kind === "inbound") return { label: "✓ replied — ball's in our court", good: true };
  const lastInbound = new Date(inbound[inbound.length - 1].at).getTime();
  const days = Math.floor((Date.now() - lastInbound) / 86400000);
  if (isNaN(days)) return { label: "✓ has replied before", good: true };
  if (days <= 14) return { label: `✓ responsive (replied ${days === 0 ? "today" : `${days}d ago`})`, good: true };
  return { label: `quiet — no reply in ${days}d`, good: false };
}

export function SummaryBar({ lead, geo }: { lead: Lead; geo: LeadGeo | null }) {
  const [brief, setBrief] = useState<LeadBrief | null>(lead.brief);
  const [briefState, setBriefState] = useState<"loading" | "ready" | "off">("loading");

  useEffect(() => {
    let dead = false;
    api<{ brief: LeadBrief | null }>(`/api/leads/${encodeURIComponent(lead.id)}/brief`)
      .then((r) => {
        if (dead) return;
        setBrief(r.brief);
        setBriefState(r.brief ? "ready" : "off");
      })
      .catch(() => {
        if (!dead) setBriefState(brief ? "ready" : "off");
      });
    return () => {
      dead = true;
    };
    // Re-check when the conversation moves (timeline length changes).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead.id, lead.timeline.length]);

  const resp = responsiveness(lead);
  const days = lead.daysSinceContact;

  return (
    <div className="ledger">
      <div className="ledger-facts">
        <dl>
          {lead.headline && (
            <>
              <dt>Headline</dt>
              <dd>{lead.headline}</dd>
            </>
          )}
          <dt>Where</dt>
          <dd>{geo ? `📍 ${geo.place}` : <span className="muted">unknown — add an address</span>}</dd>
          <dt>Type</dt>
          <dd>
            <span className="chip type">
              {[lead.leadType || "Lead", lead.pianoType].filter(Boolean).join(" · ")}
            </span>
          </dd>
          <dt>Heat</dt>
          <dd>
            {lead.score ? (
              <span className="chip hot">🔥 {lead.score} / 10</span>
            ) : (
              <span className="muted">unrated</span>
            )}
          </dd>
          <dt>Quoted</dt>
          <dd>
            {lead.value ? <span className="chip quote">{lead.value}</span> : <span className="muted">no quote yet</span>}
          </dd>
          <dt>Touch</dt>
          <dd>
            added {lead.dateAdded || "?"}
            {lead.lastContact ? ` · contact ${lead.lastContact}` : ""}
            {days != null ? ` (${days}d)` : ""}
          </dd>
          <dt>Responsive</dt>
          <dd>
            <span className={`chip ${resp.good ? "resp" : "quiet"}`}>{resp.label}</span>
          </dd>
        </dl>
      </div>
      <div className="ledger-brief">
        <div className="lb-label">Arnold&apos;s briefing — where we left off</div>
        {briefState === "loading" && !brief && <p className="muted">Arnold is reviewing the thread…</p>}
        {briefState === "off" && !brief && (
          <p className="muted">Briefings need ANTHROPIC_API_KEY — facts above are live.</p>
        )}
        {brief && (
          <>
            <p>{brief.leftOff}</p>
            {brief.nextAction && <div className="ledger-next">➤ Next: {brief.nextAction}</div>}
          </>
        )}
      </div>
    </div>
  );
}
