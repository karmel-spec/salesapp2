"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { Lead } from "@/lib/leads";
import { api, fetchLeads, getWho, LEAD_SOURCES, INQUIRY_METHODS } from "@/lib/client";
import { RepBadge, StaleBadge, StatusBadge, fmtDays, pendingDrafts } from "@/components/ui";

const BUCKETS = ["all", "open", "new", "active", "snoozed", "won", "lost", "closed", "unqualified", "inactive", "support"] as const;

/** Initial filters from the URL (?bucket=open|won|… & ?stale=1) so dashboard tiles can deep-link. */
function initialParams() {
  if (typeof window === "undefined") return { bucket: "all" as (typeof BUCKETS)[number], stale: false };
  const q = new URLSearchParams(window.location.search);
  const b = q.get("bucket") || "all";
  return {
    bucket: (BUCKETS as readonly string[]).includes(b) ? (b as (typeof BUCKETS)[number]) : "all",
    stale: q.get("stale") === "1",
  };
}

export default function LeadsPage() {
  const router = useRouter();
  const [leads, setLeads] = useState<Lead[] | null>(null);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [bucket, setBucket] = useState<(typeof BUCKETS)[number]>(() => initialParams().bucket);
  const [rep, setRep] = useState("all");
  const [staleOnly, setStaleOnly] = useState(() => initialParams().stale);
  const [showNew, setShowNew] = useState(false);

  useEffect(() => {
    fetchLeads().then((r) => setLeads(r.leads)).catch((e) => setError(e.message));
  }, []);

  const reps = useMemo(() => {
    if (!leads) return [];
    // Sally retired — her historical leads keep her badge, but she's not a filter option.
    return Array.from(new Set(leads.map((l) => l.effectiveRep).filter(Boolean)))
      .filter((r) => r !== "Sally")
      .sort();
  }, [leads]);

  const filtered = useMemo(() => {
    if (!leads) return [];
    const needle = q.trim().toLowerCase();
    return leads.filter((l) => {
      if (bucket === "open") {
        if (l.statusBucket !== "new" && l.statusBucket !== "active") return false;
      } else if (bucket !== "all" && l.statusBucket !== bucket) return false;
      if (rep !== "all" && l.effectiveRep !== rep) return false;
      if (staleOnly && !l.isStale) return false;
      if (!needle) return true;
      return [l.name, l.headline, l.leadType, l.pianoType, l.phone, l.email, l.notes]
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }, [leads, q, bucket, rep, staleOnly]);

  if (error) return <div className="banner bad">⚠ {error}</div>;
  if (!leads) return <div className="spin">Loading leads…</div>;

  return (
    <>
      <div className="page-head">
        <h1>Leads</h1>
        <span className="sub">{filtered.length} of {leads.length}</span>
        <span className="spacer" />
        <button className="btn" onClick={() => setShowNew((v) => !v)}>+ New lead</button>
      </div>

      {showNew && <NewLeadForm onDone={() => { setShowNew(false); fetchLeads(true).then((r) => setLeads(r.leads)); }} />}

      <div className="toolbar">
        <input type="search" placeholder="Search name, piano, notes…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={bucket} onChange={(e) => setBucket(e.target.value as (typeof BUCKETS)[number])}>
          {BUCKETS.map((b) => (
            <option key={b} value={b}>
              {b === "all" ? "All statuses" : b === "open" ? "Open (new + active)" : b[0].toUpperCase() + b.slice(1)}
            </option>
          ))}
        </select>
        <select value={rep} onChange={(e) => setRep(e.target.value)}>
          <option value="all">All reps</option>
          {reps.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13.5 }}>
          <input type="checkbox" checked={staleOnly} onChange={(e) => setStaleOnly(e.target.checked)} />
          Stale only
        </label>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Customer</th>
              <th>Status</th>
              <th>Rep</th>
              <th>Type</th>
              <th>Last contact</th>
              <th>Drafts</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((l) => (
              <tr key={l.id} onClick={() => router.push(`/leads/${encodeURIComponent(l.id)}`)}>
                <td>
                  <div className="lead-name">{l.name}</div>
                  <div className="muted">{l.headline || l.notes.slice(0, 80) || "—"}</div>
                </td>
                <td><StatusBadge lead={l} /> <StaleBadge lead={l} /></td>
                <td><RepBadge rep={l.effectiveRep} /></td>
                <td className="muted">{l.leadType || "—"}{l.pianoType ? ` · ${l.pianoType}` : ""}</td>
                <td className="muted">{fmtDays(l)}</td>
                <td>{pendingDrafts(l).length > 0 && <span className="badge pending-draft">{pendingDrafts(l).length} pending</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function NewLeadForm({ onDone }: { onDone: () => void }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [f, setF] = useState({
    firstName: "", lastName: "", headline: "", phone: "", email: "", social: "",
    source: "", inquiryMethod: "", leadType: "", pianoType: "", notes: "", capturedBy: "",
  });
  const [otherSource, setOtherSource] = useState("");
  const [otherInquiry, setOtherInquiry] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const payload = {
        ...f,
        source: f.source === "__other__" ? otherSource.trim() : f.source,
        inquiryMethod: f.inquiryMethod === "__other__" ? otherInquiry.trim() : f.inquiryMethod,
        capturedBy: f.capturedBy || getWho(),
      };
      await api("/api/leads", { method: "POST", body: JSON.stringify(payload) });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="card" style={{ marginBottom: 16 }} onSubmit={submit}>
      <h2>New lead <span className="muted" style={{ fontFamily: "var(--sans)", fontWeight: 400 }}>— assigned to Brigham by default</span></h2>
      {error && <div className="banner bad">⚠ {error}</div>}
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
        {(
          [
            ["firstName", "First name *"], ["lastName", "Last name"], ["headline", "Headline"],
            ["phone", "Phone"], ["email", "Email"], ["social", "Social media handle"],
            ["leadType", "Type of lead"], ["pianoType", "Type of piano"], ["capturedBy", "Captured by"],
          ] as const
        ).map(([key, label]) => (
          <div key={key}>
            <label className="field">{label}</label>
            <input
              style={{ width: "100%" }}
              placeholder={key === "social" ? "e.g. @jane.doe on Instagram / FB Marketplace link" : undefined}
              value={f[key]}
              onChange={(e) => setF({ ...f, [key]: e.target.value })}
            />
          </div>
        ))}
        <div>
          <label className="field">Source</label>
          <select style={{ width: "100%" }} value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })}>
            <option value="">— how they found us</option>
            {LEAD_SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
            <option value="__other__">Other…</option>
          </select>
          {f.source === "__other__" && (
            <input style={{ width: "100%", marginTop: 6 }} placeholder="Source" value={otherSource} onChange={(e) => setOtherSource(e.target.value)} autoFocus />
          )}
        </div>
        <div>
          <label className="field">Inquiry method</label>
          <select style={{ width: "100%" }} value={f.inquiryMethod} onChange={(e) => setF({ ...f, inquiryMethod: e.target.value })}>
            <option value="">— how they reached out</option>
            {INQUIRY_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
            <option value="__other__">Other…</option>
          </select>
          {f.inquiryMethod === "__other__" && (
            <input style={{ width: "100%", marginTop: 6 }} placeholder="Inquiry method" value={otherInquiry} onChange={(e) => setOtherInquiry(e.target.value)} autoFocus />
          )}
        </div>
      </div>
      <div style={{ marginTop: 10 }}>
        <label className="field">Notes</label>
        <textarea rows={3} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
      </div>
      <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
        <button className="btn" disabled={saving || !f.firstName.trim()}>{saving ? "Saving…" : "Add to Leads Log"}</button>
      </div>
    </form>
  );
}
