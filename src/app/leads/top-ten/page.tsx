"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
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
  worked: boolean;
}

export default function TopTenPage() {
  return (
    <Suspense fallback={<div className="spin">Pulling up Arnold&apos;s Top Ten…</div>}>
      <TopTenInner />
    </Suspense>
  );
}

function TopTenInner() {
  const params = useSearchParams();
  const arnold = params.get("scope") === "arnold";
  type Data = { savedAt: string | null; auto?: boolean; exhausted?: boolean; items: Item[] };
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const scopeQ = arnold ? "scope=arnold" : "scope=brigham";

  useEffect(() => {
    api<Data>(`/api/top-ten?${scopeQ}`)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [scopeQ]);

  const nextTen = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const d = await api<Data>(`/api/top-ten?${scopeQ}&next=1`);
      if (d.exhausted) setError("No more open leads to rank right now — every open lead has been offered today.");
      else setData(d);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (error) return <div className="banner bad">⚠ {error}</div>;
  if (!data) return <div className="spin">Pulling up Arnold&apos;s Top Ten…</div>;

  const saved = data.savedAt ? new Date(data.savedAt) : null;
  const stale = saved && !data.auto ? Date.now() - saved.getTime() > 36 * 3600_000 : false;
  const open = data.items.filter((x) => !x.worked);
  const worked = data.items.filter((x) => x.worked);
  const ordered = [...open, ...worked];

  return (
    <>
      <div className="page-head">
        <Link href={arnold ? "/leads" : "/bl-leads"} className="muted">← {arnold ? "Leads" : "BL Leads"}</Link>
        <h1>⭐ {arnold ? "Arnold's Top Ten — his own leads" : "Arnold's Top Ten"}</h1>
        <span className="sub">
          {arnold
            ? data.auto
              ? "the ten leads assigned to Arnold he should work first — ranked live from the Leads Log (replies waiting, heat, value, drafts, quiet time)"
              : "Arnold's own picks among the leads assigned to him"
            : "the ten most promising revenue leads from the morning brief"}
          {saved && !data.auto ? ` · picked ${saved.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })} ${saved.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : ""}
        </span>
        <span className="spacer" />
        {data.items.length > 0 && (
          <span className="topten-progress">
            <span className="muted">{worked.length} of {data.items.length} worked</span>
            <button className="btn" onClick={nextTen} disabled={busy} title="Set these aside and rank the next ten leads that haven't been offered today">
              {busy ? "Ranking…" : "🔄 Next ten"}
            </button>
          </span>
        )}
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
          {ordered.map((x) => (
            <Link key={x.leadId} href={`/leads/${encodeURIComponent(x.leadId)}`} className={`topten-row${x.worked ? " worked" : ""}`}>
              <span className="topten-rank">{x.rank}</span>
              <span className="topten-main">
                <span className="topten-name">
                  {x.worked && <span className="badge ok" style={{ marginRight: 8 }}>✓ worked</span>}
                  {x.leadName}
                  {x.gone && <span className="muted"> (no longer in the Leads Log)</span>}
                  {["won", "closed", "lost", "inactive", "unqualified"].includes(x.statusBucket) && (
                    <span className="badge" style={{ marginLeft: 8 }}>{x.status}</span>
                  )}
                </span>
                {x.headline && <span className="topten-headline">{x.headline}</span>}
                <span className="topten-reason">💡 {x.reason || (arnold ? "Assigned to Arnold." : "On Arnold's list this morning.")}</span>
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
