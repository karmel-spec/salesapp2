"use client";

import { useEffect, useMemo, useState } from "react";
import type { Lead } from "@/lib/leads";
import { fetchLeads } from "@/lib/client";

/** Parse the reason out of a "LOST - reason" status (client-side copy). */
function lostReason(raw: string): string {
  const m = raw.trim().match(/^lost\??\s*[-–:]\s*(.+)$/i);
  return m ? m[1].trim() : "";
}

/** Sales reports — computed live from the Leads Log. */

function Bar({ name, value, max, suffix }: { name: string; value: number; max: number; suffix?: string }) {
  return (
    <div className="mag-row">
      <div className="name" title={name}>{name}</div>
      <div className="bar-wrap">
        <div className="bar" style={{ width: `${max ? Math.max(2, (value / max) * 100) : 2}%` }} />
      </div>
      <div className="num">{value}{suffix || ""}</div>
    </div>
  );
}

function countBy(items: string[]): [string, number][] {
  const m = new Map<string, number>();
  for (const raw of items) {
    const k = raw.trim() || "(not set)";
    m.set(k, (m.get(k) || 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

export default function ReportsPage() {
  const [leads, setLeads] = useState<Lead[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetchLeads().then((r) => setLeads(r.leads)).catch((e) => setError(e.message));
  }, []);

  const r = useMemo(() => {
    if (!leads) return null;
    const won = leads.filter((l) => l.statusBucket === "won");
    const lost = leads.filter((l) => l.statusBucket === "lost");
    const open = leads.filter((l) => l.statusBucket === "new" || l.statusBucket === "active");

    const winsByCloser = countBy(won.map((l) => l.closedBy || l.effectiveRep || "(unknown)"));
    const lossReasons = countBy(lost.map((l) => lostReason(l.status) || "(no reason recorded)"));

    // Conversion by source: sources with ≥3 decided (won+lost) leads.
    const bySource = new Map<string, { won: number; decided: number }>();
    for (const l of [...won, ...lost]) {
      const s = (l.source || "").trim() || "(not set)";
      const cur = bySource.get(s) || { won: 0, decided: 0 };
      cur.decided += 1;
      if (l.statusBucket === "won") cur.won += 1;
      bySource.set(s, cur);
    }
    const conversion = [...bySource.entries()]
      .filter(([, v]) => v.decided >= 3)
      .map(([s, v]) => ({ source: s, rate: Math.round((v.won / v.decided) * 100), decided: v.decided }))
      .sort((a, b) => b.rate - a.rate);

    const buckets = countBy(leads.map((l) => l.statusBucket));

    // Heat distribution across open leads.
    const heat = { hot: 0, warm: 0, cold: 0, unrated: 0 };
    for (const l of open) {
      const n = Number(l.score);
      if (!l.score || isNaN(n)) heat.unrated++;
      else if (n >= 8) heat.hot++;
      else if (n >= 5) heat.warm++;
      else heat.cold++;
    }

    // Arnold: drafts by status across all leads.
    const drafts = leads.flatMap((l) => l.drafts).filter((d) => d.createdBy.startsWith("arnold"));
    const draftStats = {
      pending: drafts.filter((d) => d.status === "pending").length,
      sent: drafts.filter((d) => d.status === "sent").length,
      dismissed: drafts.filter((d) => d.status === "dismissed").length,
    };
    const openCovered = open.filter((l) => l.drafts.some((d) => d.status === "pending")).length;

    // Pipeline value of open leads (rough: parse first number, k-suffix aware).
    let pipelineValue = 0;
    for (const l of open) {
      const m = (l.value || "").replace(/,/g, "").match(/(\d+(?:\.\d+)?)\s*k/i) || (l.value || "").replace(/,/g, "").match(/(\d{3,})/);
      if (m) pipelineValue += /k/i.test(m[0]) ? Number(m[1]) * 1000 : Number(m[1]);
    }

    return { won, lost, open, winsByCloser, lossReasons, conversion, buckets, heat, draftStats, openCovered };
  }, [leads]);

  if (error) return <div className="banner bad">⚠ {error}</div>;
  if (!leads || !r) return <div className="spin">Crunching the Leads Log…</div>;

  const maxWin = r.winsByCloser[0]?.[1] || 0;
  const maxLoss = r.lossReasons[0]?.[1] || 0;

  return (
    <>
      <div className="page-head">
        <h1>Reports</h1>
        <span className="sub">computed live from the Leads Log — {leads.length} leads all-time</span>
      </div>

      <div className="grid tiles" style={{ marginBottom: 18 }}>
        <div className="card tile">
          <div className="label">Open pipeline</div>
          <div className="value">{r.open.length}</div>
          <div className="hint">new + active leads</div>
        </div>
        <div className="card tile">
          <div className="label">Won all-time</div>
          <div className="value">{r.won.length}</div>
          <div className="hint">{Math.round((r.won.length / Math.max(1, r.won.length + r.lost.length)) * 100)}% of decided leads</div>
        </div>
        <div className="card tile">
          <div className="label">Hot open leads (8+)</div>
          <div className="value">{r.heat.hot}</div>
          <div className="hint">{r.heat.warm} warm · {r.heat.cold} cold · {r.heat.unrated} unrated</div>
        </div>
        <div className="card tile">
          <div className="label">Arnold coverage</div>
          <div className="value">{r.openCovered}</div>
          <div className="hint">open leads with a pending draft · {r.draftStats.sent} of his drafts sent all-time</div>
        </div>
      </div>

      <div className="two-col">
        <div>
          <div className="card" style={{ marginBottom: 18 }}>
            <h2>Wins by closer</h2>
            {r.winsByCloser.length === 0 && <div className="muted">No won leads yet.</div>}
            {r.winsByCloser.map(([name, n]) => (
              <Bar key={name} name={name} value={n} max={maxWin} />
            ))}
            <div className="muted" style={{ marginTop: 8 }}>
              Older wins predate closer tracking — they count under the lead&apos;s rep.
            </div>
          </div>

          <div className="card" style={{ marginBottom: 18 }}>
            <h2>Why we lose</h2>
            {r.lossReasons.map(([reason, n]) => (
              <Bar key={reason} name={reason} value={n} max={maxLoss} />
            ))}
          </div>
        </div>

        <div>
          <div className="card" style={{ marginBottom: 18 }}>
            <h2>Win rate by source of business</h2>
            {r.conversion.length === 0 && <div className="muted">Not enough decided leads with a recorded source yet — keep filling in Source of business.</div>}
            {r.conversion.map((c) => (
              <Bar key={c.source} name={`${c.source} (${c.decided})`} value={c.rate} max={100} suffix="%" />
            ))}
            <div className="muted" style={{ marginTop: 8 }}>Sources with 3+ decided (won or lost) leads.</div>
          </div>

          <div className="card">
            <h2>Pipeline by status</h2>
            {r.buckets.map(([bucket, n]) => (
              <Bar key={bucket} name={bucket} value={n} max={r.buckets[0]?.[1] || 0} />
            ))}
            <div className="muted" style={{ marginTop: 8 }}>
              Arnold drafts all-time: {r.draftStats.sent} sent · {r.draftStats.pending} pending · {r.draftStats.dismissed} dismissed
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
