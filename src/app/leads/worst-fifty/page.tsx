"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, getWho } from "@/lib/client";

/** 💀 Worst 50 — the leads least worth the team's time. Arnold sends a quick
 *  check-in text from each lead page, then marks the silent ones Dormant here. */
interface Item { rank: number; leadId: string; leadName: string; rep: string; reason: string; touches: number; replies: number; hasPhone: boolean; hasEmail: boolean; headline: string; status: string; worked: boolean }

export default function WorstFiftyPage() {
  const [data, setData] = useState<{ items: Item[] } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string>("");
  const [gone, setGone] = useState<Record<string, string>>({});

  const load = () => api<{ items: Item[] }>("/api/worst-fifty").then(setData).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  async function markDormant(x: Item) {
    setBusy(x.leadId);
    try {
      await api(`/api/leads/${encodeURIComponent(x.leadId)}`, { method: "PATCH", body: JSON.stringify({ fields: { status: "Dormant" }, who: getWho() }) });
      await api(`/api/leads/${encodeURIComponent(x.leadId)}/timeline`, { method: "POST", body: JSON.stringify({ kind: "note", text: `🌙 Marked Dormant from the Worst 50 (${x.reason}). No more outreach — wakes to Active automatically if they contact us.`, who: getWho() }) });
      setGone((g) => ({ ...g, [x.leadId]: "Dormant" }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }

  if (error) return <div className="banner bad">⚠ {error}</div>;
  if (!data) return <div className="spin">Ranking the weakest leads…</div>;
  const items = data.items;
  const done = items.filter((x) => x.worked || gone[x.leadId]).length;
  return (
    <>
      <div className="page-head">
        <Link href="/leads" className="muted">← Leads</Link>
        <h1>💀 Worst 50</h1>
        <span className="sub">the open leads least likely to close — quick check-in text from each lead page, then mark the silent ones Dormant. Not Brigham&apos;s leads; live watch leads excluded.</span>
        <span className="spacer" />
        <span className="topten-progress"><span className="muted">{done} of {items.length} handled</span><button className="btn ghost" onClick={load}>↻ Refresh</button></span>
      </div>
      <div className="topten-list">
        {items.map((x) => {
          const status = gone[x.leadId];
          return (
            <div key={x.leadId} className={`topten-row worst${x.worked || status ? " worked" : ""}`}>
              <span className="topten-rank">{x.rank}</span>
              <span className="topten-main">
                <span className="topten-name">
                  {status ? <span className="badge dormant" style={{ marginRight: 8 }}>🌙 {status}</span> : x.worked ? <span className="badge ok" style={{ marginRight: 8 }}>✓ touched today</span> : null}
                  <Link href={`/leads/${encodeURIComponent(x.leadId)}`}>{x.leadName}</Link>
                  <span className="muted"> · {x.rep}</span>
                </span>
                {x.headline && <span className="topten-headline">{x.headline}</span>}
                <span className="topten-reason">💀 {x.reason}</span>
              </span>
              <span className="topten-facts">
                <span className="chip type">{x.touches} out · {x.replies} in</span>
                {!x.hasPhone && !x.hasEmail && <span className="chip quiet">no phone / email</span>}
                {x.hasPhone && <Link className="btn small" href={`/leads/${encodeURIComponent(x.leadId)}?compose=sms`}>💬 Text</Link>}
                <button className="btn small ghost" disabled={busy === x.leadId || !!status} onClick={() => markDormant(x)}>{busy === x.leadId ? "…" : "🌙 Dormant"}</button>
              </span>
            </div>
          );
        })}
      </div>
    </>
  );
}
