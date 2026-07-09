"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { Lead } from "@/lib/leads";
import { api, fetchLeads } from "@/lib/client";
import { RepBadge, StaleBadge, StatusBadge, fmtDays, pendingDrafts } from "@/components/ui";

export default function Dashboard() {
  const [leads, setLeads] = useState<Lead[] | null>(null);
  const [writeEnabled, setWriteEnabled] = useState(true);
  const [error, setError] = useState("");
  const [sweeping, setSweeping] = useState(false);
  const [sweepResult, setSweepResult] = useState("");

  const load = () =>
    fetchLeads()
      .then((r) => {
        setLeads(r.leads);
        setWriteEnabled(r.writeEnabled);
      })
      .catch((e) => setError(e.message));

  useEffect(() => {
    load();
  }, []);

  const stats = useMemo(() => {
    if (!leads) return null;
    const open = leads.filter((l) => l.statusBucket === "new" || l.statusBucket === "active");
    const stale = leads.filter((l) => l.isStale);
    const approvals = leads.reduce((n, l) => n + pendingDrafts(l).length, 0);
    const won = leads.filter((l) => l.statusBucket === "won");
    const byBucket: [string, number][] = (["new", "active", "snoozed", "won", "lost", "closed", "unqualified", "inactive", "support"] as const)
      .map((b) => [b, leads.filter((l) => l.statusBucket === b).length] as [string, number])
      .filter(([, n]) => n > 0);
    return { open, stale, approvals, won, byBucket, arnoldQueue: leads.filter((l) => l.effectiveRep === "Arnold" && (l.statusBucket === "new" || l.statusBucket === "active")) };
  }, [leads]);

  async function runSweep() {
    setSweeping(true);
    setSweepResult("");
    try {
      const r = await api<{ reassigned: { name: string }[]; woken?: { name: string }[] }>("/api/sync", { method: "POST" });
      const parts: string[] = [];
      if (r.reassigned.length) parts.push(`Reassigned ${r.reassigned.length} stale lead(s) to Arnold: ${r.reassigned.map((x) => x.name).join(", ")}`);
      if (r.woken?.length) parts.push(`⏰ Woke ${r.woken.length} snoozed lead(s): ${r.woken.map((x) => x.name).join(", ")}`);
      setSweepResult(parts.join(" · ") || "Nothing to do — the sheet is already up to date.");
      load();
    } catch (e) {
      setSweepResult(e instanceof Error ? e.message : String(e));
    } finally {
      setSweeping(false);
    }
  }

  if (error) return <div className="banner bad">⚠ {error}</div>;
  if (!leads || !stats) return <div className="spin">Loading the Leads Log…</div>;

  const maxBucket = Math.max(...stats.byBucket.map(([, n]) => n), 1);

  return (
    <>
      <div className="page-head">
        <h1>Dashboard</h1>
        <span className="sub">Leads Log · live from Google Sheets</span>
        <span className="spacer" />
        <button className="btn ghost small" onClick={() => load()}>↻ Refresh</button>
        <button className="btn small" onClick={runSweep} disabled={sweeping || !writeEnabled} title={writeEnabled ? "Persist the 30-day rule to the sheet" : "Read-only mode — connect the Google service account to enable"}>
          {sweeping ? "Sweeping…" : "Run Arnold stale sweep"}
        </button>
      </div>

      {!writeEnabled && (
        <div className="banner warn">
          ⚠ Read-only snapshot mode — the sheet is being read via its share link. Add the Google service
          account credentials (see Settings) to enable two-way sync.
        </div>
      )}
      {sweepResult && <div className="banner info">{sweepResult}</div>}

      <div className="grid tiles" style={{ marginBottom: 18 }}>
        <Link href="/leads?bucket=open" className="card tile linky">
          <div className="label">Open leads</div>
          <div className="value">{stats.open.length}</div>
          <div className="hint">new + active pipeline →</div>
        </Link>
        <Link href="/leads?stale=1" className={`card tile linky ${stats.stale.length ? "alert" : ""}`}>
          <div className="label">Stale (30d+)</div>
          <div className="value">{stats.stale.length}</div>
          <div className="hint">auto-assigned to Arnold →</div>
        </Link>
        <Link href="/approvals" className={`card tile linky ${stats.approvals ? "alert" : ""}`}>
          <div className="label">Awaiting approval</div>
          <div className="value">{stats.approvals}</div>
          <div className="hint">Arnold drafts to review →</div>
        </Link>
        <Link href="/leads?bucket=won" className="card tile linky">
          <div className="label">Won</div>
          <div className="value">{stats.won.length}</div>
          <div className="hint">all-time on this log →</div>
        </Link>
      </div>

      <div className="two-col">
        <div className="card">
          <h2>Needs attention — Arnold&apos;s queue</h2>
          {stats.arnoldQueue.length === 0 && <div className="muted">Nothing stale. Nice work keeping up!</div>}
          <div className="table-wrap" style={{ border: "none" }}>
            <table>
              <tbody>
                {stats.arnoldQueue.slice(0, 12).map((l) => (
                  <tr key={l.id} onClick={() => (window.location.href = `/leads/${encodeURIComponent(l.id)}`)}>
                    <td>
                      <div className="lead-name">{l.name}</div>
                      <div className="muted">{l.headline || l.leadType || "—"}</div>
                    </td>
                    <td><StatusBadge lead={l} /></td>
                    <td><StaleBadge lead={l} /></td>
                    <td className="muted">{fmtDays(l)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <h2>Pipeline breakdown</h2>
          {stats.byBucket.map(([bucket, n]) => (
            <div className="mag-row" key={bucket}>
              <span className="name" style={{ textTransform: "capitalize" }}>{bucket}</span>
              <span className="bar-wrap">
                <span className="bar" style={{ width: `${(n / maxBucket) * 100}%`, display: "block" }} />
              </span>
              <span className="num">{n}</span>
            </div>
          ))}
          <h2 style={{ marginTop: 22 }}>Recently added</h2>
          {leads.slice(0, 6).map((l) => (
            <div key={l.id} style={{ padding: "7px 0", borderBottom: "1px solid #f0ece6" }}>
              <Link href={`/leads/${encodeURIComponent(l.id)}`}>
                <span className="lead-name">{l.name}</span>{" "}
                <span className="muted">— {l.headline || l.leadType || "new inquiry"}</span>{" "}
                <RepBadge rep={l.effectiveRep} />
              </Link>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
