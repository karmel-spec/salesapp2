"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/client";

/**
 * ⭐ Arnold's Top Ten — Brigham's daily sales work screen. ONLY the ten most
 * promising revenue leads from this morning's brief, ranked, with Arnold's
 * reason and one click straight into each lead.
 */

interface Item {
  rank: number;
  leadId: string;
  leadName: string;
  reason: string;
  headline: string;
  leadType: string;
  pianoType: string;
  heat: string;
  value: string;
  daysQuiet: number | null;
  rep: string;
  status: string;
  statusBucket: string;
  pendingDrafts: number;
  hasPhone: boolean;
  hasEmail: boolean;
  gone: boolean;
}

export default function TopTenPage() {
  const [data, setData] = useState<{ savedAt: string | null; items: Item[] } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api<{ savedAt: string | null; items: Item[] }>("/api/top-ten")
      .then(setData)
      .catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="banner bad">⚠ {error}</div>;
  if (!data) return <div className="spin">Pulling up Arnold&apos;s Top Ten…</div>;

  const saved = data.savedAt ? new Date(data.savedAt) : null;
  const stale = saved ? Date.now() - saved.getTime() > 36 * 3600_000 : false;

  return (
    <>
      <div className="page-head">
        <Link href="/leads" className="muted">← Leads</Link>
        <h1>⭐ Arnold&apos;s Top Ten</h1>
        <span className="sub">
          the ten most promising revenue leads from the morning brief
          {saved ? ` · picked ${saved.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })} ${saved.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : ""}
        </span>
      </div>

      {stale && (
        <div className="banner info">
          ⏰ This list is from a previous day — tomorrow&apos;s morning brief refreshes it automatically.
        </div>
      )}

      {data.items.length === 0 ? (
        <div className="card">
          <h2>No Top Ten saved yet</h2>
          <div className="muted">
            Arnold saves his ten picks with each weekday morning brief. The first list lands with the next brief.
          </div>
        </div>
      ) : (
        <div className="topten-list">
          {data.items.map((x) => (
            <Link key={x.leadId} href={`/leads/${encodeURIComponent(x.leadId)}`} className="topten-row">
              <span className="topten-rank">{x.rank}</span>
              <span className="topten-main">
                <span className="topten-name">
                  {x.leadName}
                  {x.gone && <span className="muted"> (no longer in the Leads Log)</span>}
                  {["won", "closed", "lost", "inactive", "unqualified"].includes(x.statusBucket) && (
                    <span className="badge" style={{ marginLeft: 8 }}>{x.status}</span>
                  )}
                </span>
                {x.headline && <span className="topten-headline">{x.headline}</span>}
                <span className="topten-reason">💡 {x.reason || "On Arnold's list this morning."}</span>
              </span>
              <span className="topten-facts">
                {x.heat && <span className="chip hot">🔥 {x.heat}/10</span>}
                {x.value && <span className="chip quote">{x.value}</span>}
                {x.daysQuiet !== null && (
                  <span className={`chip ${x.daysQuiet >= 7 ? "quiet" : "resp"}`}>
                    {x.daysQuiet === 0 ? "today" : `${x.daysQuiet}d quiet`}
                  </span>
                )}
                {x.pendingDrafts > 0 && <span className="chip type">✍️ {x.pendingDrafts} draft{x.pendingDrafts > 1 ? "s" : ""} waiting</span>}
              </span>
              <span className="topten-go">Work it →</span>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
