"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Lead } from "@/lib/leads";
import { api, fetchLeads, getWho, LEAD_SOURCES, INQUIRY_METHODS, PIANO_TYPES, LEAD_TYPES, MELISSA_TYPES, ENTERED_BY, useRoster, prioritySort } from "@/lib/client";
import { RepBadge, StaleBadge, StatusBadge, fmtDays, pendingDrafts } from "@/components/ui";
import { AddressInput } from "@/components/AddressInput";
import { AttachButton, type PickedFile } from "@/components/AttachButton";
import { looseIncludes } from "@/lib/search";

const BUCKETS = ["all", "open", "new", "active", "snoozed", "won", "lost", "closed", "unqualified", "inactive", "support"] as const;

const SORT_MODES = ["priority", "newest", "contact-newest", "contact-oldest"] as const;
type SortMode = (typeof SORT_MODES)[number];

/** Initial filters, the same every visit: the signed-in rep's own Active
 *  Sales leads, newest first. A URL deep link (?bucket=…, ?stale=1 or
 *  ?drafts=1 from the dashboard tiles) overrides the status filter; the
 *  flag links also widen the type filter so their counts match the tiles. */
/** Which slice of the log a tab shows: Brigham's leads, everyone else's,
 *  Customer Service (the Support status — walk-up questions, not sales), or
 *  (dashboard deep links with ?all=1) the whole company. Support contacts
 *  never appear on the two lead tabs. */
export type LeadsScope = "brigham" | "others" | "support";
const BRIGHAM = "Brigham";
/** Type-filter value for leads whose "Type of lead" cell is blank. */
const NO_TYPE = "__none__";
/** Former team members: their old leads keep the badge, but they're not filter options. */
const RETIRED_REPS = new Set(["Sally", "Susie"]);

function initialParams(scope?: LeadsScope) {
  const defaults =
    scope === "support"
      ? { bucket: "all" as (typeof BUCKETS)[number], stale: false, drafts: false, rep: "all", typeFilter: "all", sortMode: "newest" as SortMode }
      : { bucket: "active" as (typeof BUCKETS)[number], stale: false, drafts: false, rep: "all", typeFilter: "Sales", sortMode: "newest" as SortMode };
  if (typeof window === "undefined") return defaults;
  const q = new URLSearchParams(window.location.search);
  const who = localStorage.getItem("blp_rep_name") || "";
  const flagged = q.get("stale") === "1" || q.get("drafts") === "1";
  const b = q.get("bucket") || (flagged ? "all" : defaults.bucket);
  return {
    ...defaults,
    bucket: (BUCKETS as readonly string[]).includes(b) ? (b as (typeof BUCKETS)[number]) : defaults.bucket,
    stale: q.get("stale") === "1",
    drafts: q.get("drafts") === "1",
    typeFilter: flagged ? "all" : defaults.typeFilter,
    // BL Leads is already Brigham's; on the team tab Brigham sees everyone;
    // Customer Service is a shared queue.
    rep: scope === "brigham" || scope === "support" || who === BRIGHAM ? "all" : who || "all",
  };
}

export function LeadsView({ scope: tabScope }: { scope?: LeadsScope }) {
  const router = useRouter();
  // ?all=1 (dashboard tiles, old bookmarks) shows the whole company on either tab.
  const [scope] = useState<LeadsScope | undefined>(() =>
    typeof window !== "undefined" && new URLSearchParams(window.location.search).get("all") === "1" ? undefined : tabScope
  );
  const [leads, setLeads] = useState<Lead[] | null>(null);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [bucket, setBucket] = useState<(typeof BUCKETS)[number]>(() => initialParams(scope).bucket);
  const [rep, setRep] = useState(() => initialParams(scope).rep);
  const [typeFilter, setTypeFilter] = useState(() => initialParams(scope).typeFilter);
  const [staleOnly, setStaleOnly] = useState(() => initialParams().stale);
  const [draftsOnly, setDraftsOnly] = useState(() => initialParams().drafts);
  // ?new=1 (the sidebar's "+ New lead" button) opens the form on arrival.
  const [showNew, setShowNew] = useState(
    () => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("new") === "1"
  );
  const [sortMode, setSortMode] = useState<SortMode>(() => initialParams().sortMode);

  useEffect(() => {
    fetchLeads().then((r) => setLeads(r.leads)).catch((e) => setError(e.message));
  }, []);

  // The sidebar's "+ New lead" button: opens the form when we're already on
  // this tab (event) or on arrival (?new=1, which we then clear from the URL).
  useEffect(() => {
    const open = () => {
      setShowNew(true);
      window.scrollTo({ top: 0, behavior: "smooth" });
    };
    window.addEventListener("blp:new-lead", open);
    if (new URLSearchParams(window.location.search).get("new") === "1") {
      setShowNew(true);
      const url = new URL(window.location.href);
      url.searchParams.delete("new");
      window.history.replaceState(null, "", url.pathname + (url.search || ""));
    }
    return () => window.removeEventListener("blp:new-lead", open);
  }, []);

  // The slice this tab works from; every count and filter starts here.
  const pool = useMemo(() => {
    if (!leads) return [];
    if (scope === "support") return leads.filter((l) => l.statusBucket === "support");
    const real = leads.filter((l) => l.statusBucket !== "support"); // customer service lives on its own tab
    if (scope === "brigham") return real.filter((l) => l.effectiveRep === BRIGHAM);
    if (scope === "others") return real.filter((l) => l.effectiveRep !== BRIGHAM);
    return leads;
  }, [leads, scope]);

  // Filter options = the current team roster (so new admins like Lisa appear
  // before they own a lead) plus anyone who actually holds a lead here.
  const roster = useRoster();
  const reps = useMemo(() => {
    return Array.from(new Set([...roster, ...pool.flatMap((l) => [l.effectiveRep, l.effectiveSubRep])].filter(Boolean)))
      .filter((r) => !RETIRED_REPS.has(r))
      .sort();
  }, [pool, roster]);

  // Header counts: shown (after filters) · active (New + Active) · total in this tab.
  const activeInPool = useMemo(
    () => pool.filter((l) => l.statusBucket === "new" || l.statusBucket === "active").length,
    [pool]
  );

  const leadTypes = useMemo(() => {
    if (!leads) return [];
    // The sheet's "Type of lead" column has free-text strays (long sentences,
    // "?") — the dropdown only lists clean types: the canonical list plus any
    // short value used by 2+ leads.
    const counts = new Map<string, number>();
    for (const l of leads) {
      const t = l.leadType.trim();
      if (t) counts.set(t, (counts.get(t) || 0) + 1);
    }
    // Dedupe case-insensitively ("Trade-in Sales Lead" vs "Trade-in sales
    // lead") — the filter itself also matches case-insensitively.
    const clean = new Map<string, string>();
    for (const t of LEAD_TYPES) if (counts.has(t)) clean.set(t.toLowerCase(), t);
    for (const [t, n] of counts) {
      if (n >= 2 && t.length <= 28 && t !== "?" && !clean.has(t.toLowerCase())) clean.set(t.toLowerCase(), t);
    }
    return Array.from(clean.values()).sort();
  }, [leads]);

  const filtered = useMemo(() => {
    const needle = q.trim();
    const visible = pool.filter((l) => {
      if (bucket === "open") {
        if (l.statusBucket !== "new" && l.statusBucket !== "active") return false;
      } else if (bucket !== "all" && l.statusBucket !== bucket) return false;
      if (rep !== "all" && l.effectiveRep !== rep && l.effectiveSubRep !== rep) return false;
      if (typeFilter === NO_TYPE) {
        if (l.leadType.trim()) return false;
      } else if (typeFilter !== "all" && l.leadType.trim().toLowerCase() !== typeFilter.toLowerCase()) return false;
      if (staleOnly && !l.isStale) return false;
      if (draftsOnly && pendingDrafts(l).length === 0) return false;
      if (!needle) return true;
      // Forgiving match: any word order, punctuation/case ignored, phones
      // compared digits-to-digits (see lib/search.ts).
      return looseIncludes(
        [l.name, l.headline, l.leadType, l.pianoType, l.phone, l.email, l.address, l.notes].join(" "),
        needle
      );
    });
    if (sortMode === "priority") return prioritySort(visible);
    if (sortMode === "contact-newest" || sortMode === "contact-oldest") {
      const t = (l: Lead) => (l.lastTouchISO ? new Date(l.lastTouchISO).getTime() : null);
      return [...visible].sort((a, b) => {
        const ta = t(a);
        const tb = t(b);
        if (ta === null && tb === null) return 0;
        if (ta === null) return 1; // undated always sinks
        if (tb === null) return -1;
        return sortMode === "contact-newest" ? tb - ta : ta - tb;
      });
    }
    return visible;
  }, [pool, q, bucket, rep, typeFilter, staleOnly, draftsOnly, sortMode]);

  if (error) return <div className="banner bad">⚠ {error}</div>;
  if (!leads) return <div className="spin">Loading leads…</div>;

  return (
    <>
      <div className="page-head">
        <h1>{scope === "brigham" ? "BL Leads" : scope === "support" ? "Customer Service" : "Leads"}</h1>
        <span className="sub" title="First number = leads matching the filters below · 'active' = status New or Active (the nav bubble)">
          {scope === "support" ? (
            <>{filtered.length} of {pool.length} support inquiries — walk-up questions, tuning, moving; not sales leads</>
          ) : (
            <>
              {filtered.length}
              {typeFilter === NO_TYPE ? " untyped" : typeFilter !== "all" ? ` ${typeFilter.toLowerCase()}` : ""}
              {bucket === "active" || bucket === "open" || bucket === "new"
                ? ` of ${activeInPool} active`
                : bucket === "all"
                  ? " in any status"
                  : ` · ${bucket}`}
              {scope === "brigham" ? " assigned to Brigham" : scope === "others" ? " (everyone but Brigham)" : " company-wide"}
            </>
          )}
        </span>
        <span className="spacer" />
        {scope !== "support" && (
        <button
          className="topten-burst"
          title="Arnold's Top Ten — today's ten most promising revenue leads"
          onClick={() => router.push("/leads/top-ten")}
        >
          <span>TOP<br />TEN</span>
        </button>
        )}
      </div>

      {showNew && <NewLeadForm onDone={() => { setShowNew(false); fetchLeads(true).then((r) => setLeads(r.leads)); }} />}

      <div className="toolbar">
        <input type="search" placeholder="Search name, piano, notes…" value={q} onChange={(e) => setQ(e.target.value)} />
        {scope !== "support" && (
          <select value={bucket} onChange={(e) => setBucket(e.target.value as (typeof BUCKETS)[number])}>
            {BUCKETS.filter((b) => b !== "support").map((b) => (
              <option key={b} value={b}>
                {b === "all" ? "All statuses" : b === "open" ? "Open (new + active)" : b[0].toUpperCase() + b.slice(1)}
              </option>
            ))}
          </select>
        )}
        {scope !== "brigham" && (
          <select value={rep} onChange={(e) => setRep(e.target.value)}>
            <option value="all">All reps</option>
            {/* Keep the signed-in rep selectable even before they own a lead. */}
            {(rep !== "all" && !reps.includes(rep) ? [rep, ...reps] : reps).map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        )}
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} aria-label="Type of lead">
          <option value="all">All types of leads</option>
          <option value={NO_TYPE}>No type set</option>
          {(typeFilter !== "all" && typeFilter !== NO_TYPE && !leadTypes.includes(typeFilter) ? [typeFilter, ...leadTypes] : leadTypes).map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={sortMode} onChange={(e) => setSortMode(e.target.value as typeof sortMode)} aria-label="Sort order">
          <option value="priority">Priority order</option>
          <option value="newest">Newest first</option>
          <option value="contact-oldest">Quiet longest (last contact ↑)</option>
          <option value="contact-newest">Contacted recently (last contact ↓)</option>
        </select>
        {staleOnly && (
          <span className="badge stale" style={{ cursor: "pointer" }} title="Showing stale leads only — click to clear" onClick={() => setStaleOnly(false)}>
            stale only ✕
          </span>
        )}
        {draftsOnly && (
          <span className="badge" style={{ cursor: "pointer" }} title="Showing leads with Arnold drafts awaiting approval — click to clear" onClick={() => setDraftsOnly(false)}>
            awaiting approval ✕
          </span>
        )}
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Customer</th>
              <th>Status</th>
              <th>Rep</th>
              <th>Type</th>
              <th>Heat</th>
              <th
                onClick={() =>
                  setSortMode((cur) => (cur === "contact-oldest" ? "contact-newest" : "contact-oldest"))
                }
                style={{ cursor: "pointer", userSelect: "none" }}
                title="Click to sort by last contact — quiet longest ⇄ most recent"
              >
                Last contact{sortMode === "contact-oldest" ? " ↑" : sortMode === "contact-newest" ? " ↓" : ""}
              </th>
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
                <td><RepBadge rep={l.effectiveRep} subRep={l.effectiveSubRep} /></td>
                <td className="muted">{l.leadType || "—"}{l.pianoType ? ` · ${l.pianoType}` : ""}</td>
                <td>{l.score ? <span style={{ fontWeight: 600, color: Number(l.score) >= 8 ? "#9e2020" : Number(l.score) >= 5 ? "#8a5a00" : "#33526e" }}>{Number(l.score) >= 8 ? "🔥 " : ""}{l.score}</span> : <span className="muted">—</span>}</td>
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
    firstName: "", lastName: "", headline: "", phone: "", email: "", social: "", address: "",
    source: "", inquiryMethod: "", leadType: "", pianoType: "", notes: "", capturedBy: "",
    openedBy: "Brigham", score: "",
  });
  const [other, setOther] = useState({ source: "", inquiryMethod: "", leadType: "", pianoType: "", capturedBy: "" });
  const [files, setFiles] = useState<PickedFile[]>([]);
  const roster = useRoster();
  const openedByTouched = useRef(false);

  // Default "Entered by" to whoever is signed in on this device.
  useEffect(() => {
    const me = getWho();
    if (me !== "app" && ENTERED_BY.includes(me)) setF((cur) => ({ ...cur, capturedBy: me }));
  }, []);

  // Event Rental / Piano Moving leads route to Melissa unless a rep was picked.
  useEffect(() => {
    if (MELISSA_TYPES.includes(f.leadType) && !openedByTouched.current) {
      setF((cur) => ({ ...cur, openedBy: "Melissa" }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.leadType]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const resolve = (key: keyof typeof other) =>
        f[key] === "__other__" ? other[key].trim() : f[key];
      const payload = {
        ...f,
        source: resolve("source"),
        inquiryMethod: resolve("inquiryMethod"),
        leadType: resolve("leadType"),
        pianoType: resolve("pianoType"),
        capturedBy: resolve("capturedBy") || getWho(),
      };
      const created = await api<{ id: string }>("/api/leads", { method: "POST", body: JSON.stringify(payload) });
      // Upload any attachments onto the freshly created lead.
      for (const file of files) {
        await api(`/api/leads/${encodeURIComponent(created.id)}/files`, {
          method: "POST",
          body: JSON.stringify({ name: file.name, type: file.type, dataBase64: file.dataBase64, who: getWho() }),
        }).catch(() => {}); // a failed upload shouldn't lose the lead
      }
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="card" style={{ marginBottom: 16 }} onSubmit={submit}>
      <h2>New lead <span className="muted" style={{ fontFamily: "var(--sans)", fontWeight: 400 }}>— assigned to whoever opens it (Brigham by default)</span></h2>
      {error && <div className="banner bad">⚠ {error}</div>}
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
        {(
          [
            ["firstName", "First name *"], ["lastName", "Last name"], ["headline", "Headline"],
            ["phone", "Phone"], ["email", "Email"], ["social", "Social handle"],
            ["address", "Address"],
          ] as const
        ).map(([key, label]) => (
          <div key={key}>
            <label className="field">{label}</label>
            {key === "address" ? (
              <AddressInput
                value={f.address}
                onChange={(v) => setF({ ...f, address: v })}
                placeholder="start typing — Google suggests the address"
              />
            ) : (
              <input
                style={{ width: "100%" }}
                placeholder={key === "social" ? "e.g. @jane.doe on Instagram / FB Marketplace link" : undefined}
                value={f[key]}
                onChange={(e) => setF({ ...f, [key]: e.target.value })}
              />
            )}
          </div>
        ))}
        {(
          [
            ["leadType", "Type of lead", LEAD_TYPES, "— pick a type"],
            ["pianoType", "Type of piano", PIANO_TYPES, "— pick a piano type"],
            ["source", "Source of business", LEAD_SOURCES, "— how they found us"],
            ["inquiryMethod", "Inquiry method", INQUIRY_METHODS, "— how they reached out"],
            ["capturedBy", "Entered by", ENTERED_BY, "— who is entering this lead"],
          ] as const
        ).map(([key, label, options, placeholder]) => (
          <div key={key}>
            <label className="field">{label}</label>
            <select style={{ width: "100%" }} value={f[key]} onChange={(e) => setF({ ...f, [key]: e.target.value })}>
              <option value="">{placeholder}</option>
              {options.map((o) => <option key={o} value={o}>{o}</option>)}
              <option value="__other__">{key === "capturedBy" ? "＋ Add new…" : "Other…"}</option>
            </select>
            {f[key] === "__other__" && (
              <input
                style={{ width: "100%", marginTop: 6 }}
                placeholder={label}
                value={other[key]}
                onChange={(e) => setOther({ ...other, [key]: e.target.value })}
                autoFocus
              />
            )}
          </div>
        ))}
        <div>
          <label className="field">Heat (1 cold – 10 hot)</label>
          <select style={{ width: "100%" }} value={f.score} onChange={(e) => setF({ ...f, score: e.target.value })}>
            <option value="">— rate this lead</option>
            {[10, 9, 8, 7, 6, 5, 4, 3, 2, 1].map((n) => (
              <option key={n} value={String(n)}>
                {n}{n === 10 ? " — 🔥 ready to buy" : n === 7 ? " — warm" : n === 4 ? " — lukewarm" : n === 1 ? " — ❄️ nearly dead" : ""}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="field">Lead opened by</label>
          <select
            style={{ width: "100%" }}
            value={f.openedBy}
            onChange={(e) => {
              openedByTouched.current = true;
              setF({ ...f, openedBy: e.target.value });
            }}
          >
            {roster.map((r) => <option key={r} value={r}>{r}{r === "Brigham" ? " (default)" : ""}</option>)}
          </select>
        </div>
      </div>
      <div style={{ marginTop: 10 }}>
        <label className="field">Notes</label>
        <textarea rows={3} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
      </div>
      <div style={{ marginTop: 10, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <AttachButton multiple onPick={(file) => setFiles((cur) => [...cur, file])} onError={setError} label="📎 Attach photos / files" />
        {files.map((file, i) => (
          <span key={`${file.name}-${i}`} style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
            {file.preview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={file.preview} alt={file.name} style={{ height: 40, borderRadius: 6, border: "1px solid var(--line)" }} />
            ) : (
              <span>📎</span>
            )}
            <span className="muted" style={{ fontSize: 12 }}>{file.name}</span>
            <button type="button" className="linklike" onClick={() => setFiles((cur) => cur.filter((_, j) => j !== i))}>✕</button>
          </span>
        ))}
      </div>
      <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
        <button className="btn" disabled={saving || !f.firstName.trim()}>{saving ? "Saving…" : "Add to Leads Log"}</button>
      </div>
    </form>
  );
}
