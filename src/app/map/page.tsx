"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client";
import type { MapLead } from "@/lib/geo-shared";
import { STATE_NAMES } from "@/lib/geo-shared";
import { LeadMap, Pin, heatColor, pinValue } from "@/components/LeadMap";

/**
 * Lead Map — every lead with a detectable location, pinned nationwide.
 * Built for trip planning: pick a region, see who's there and what it's
 * worth, then route the truck where the sales are.
 */

const BUCKETS = ["open", "new", "active", "snoozed", "won", "lost", "all"] as const;
type Bucket = (typeof BUCKETS)[number];

function inBucket(l: MapLead, bucket: Bucket): boolean {
  if (bucket === "all") return true;
  if (bucket === "open") return l.statusBucket === "new" || l.statusBucket === "active";
  return l.statusBucket === bucket;
}

function fmtMoney(n: number): string {
  if (!n) return "—";
  return n >= 1000 ? `$${Math.round(n / 1000)}k` : `$${n}`;
}

export default function MapPage() {
  const router = useRouter();
  const [data, setData] = useState<{ leads: MapLead[]; mapsApiKey: string } | null>(null);
  const [error, setError] = useState("");
  const [bucket, setBucket] = useState<Bucket>("open");
  const [rep, setRep] = useState("all");
  const [minHeat, setMinHeat] = useState(0);
  const [selectedState, setSelectedState] = useState("");
  const [selectedLeadId, setSelectedLeadId] = useState("");
  const [showUnlocated, setShowUnlocated] = useState(false);

  useEffect(() => {
    api<{ leads: MapLead[]; mapsApiKey: string }>("/api/map")
      .then(setData)
      .catch((e) => setError(e.message));
  }, []);

  const reps = useMemo(() => {
    if (!data) return [];
    return Array.from(new Set(data.leads.flatMap((l) => [l.rep, l.subRep]).filter(Boolean)))
      .filter((r) => r !== "Sally")
      .sort();
  }, [data]);

  const filtered = useMemo(() => {
    if (!data) return [];
    return data.leads.filter(
      (l) =>
        inBucket(l, bucket) &&
        (rep === "all" || l.rep === rep || l.subRep === rep) &&
        (minHeat === 0 || (Number(l.score) || 0) >= minHeat)
    );
  }, [data, bucket, rep, minHeat]);

  const pins: Pin[] = useMemo(
    () => filtered.filter((l) => l.geo).map((l) => ({ ...l, lat: l.geo!.lat, lng: l.geo!.lng })),
    [filtered]
  );
  const unlocated = useMemo(() => filtered.filter((l) => !l.geo), [filtered]);

  // Region ranking — the trip-planning core: which states hold the money?
  const regions = useMemo(() => {
    const by = new Map<string, { count: number; value: number }>();
    for (const p of pins) {
      const st = p.geo!.state;
      const cur = by.get(st) || { count: 0, value: 0 };
      cur.count += 1;
      cur.value += pinValue(p);
      by.set(st, cur);
    }
    return Array.from(by.entries())
      .map(([st, v]) => ({ st, ...v }))
      .sort((a, b) => b.count - a.count || b.value - a.value);
  }, [pins]);

  const stateLeads = useMemo(
    () =>
      selectedState
        ? pins.filter((p) => p.geo!.state === selectedState).sort((a, b) => pinValue(b) - pinValue(a))
        : [],
    [pins, selectedState]
  );

  if (error) return <div className="banner bad">⚠ {error}</div>;
  if (!data) return <div className="spin">Loading map…</div>;

  return (
    <>
      <div className="page-head">
        <h1>Map</h1>
        <span className="sub">
          {pins.length} of {filtered.length} leads pinned
          {unlocated.length > 0 && ` · ${unlocated.length} without a location`}
        </span>
      </div>

      <div className="toolbar">
        <select value={bucket} onChange={(e) => { setBucket(e.target.value as Bucket); setSelectedLeadId(""); }} aria-label="Status filter">
          {BUCKETS.map((b) => (
            <option key={b} value={b}>
              {b === "open" ? "Open (new + active)" : b === "all" ? "All statuses" : b[0].toUpperCase() + b.slice(1)}
            </option>
          ))}
        </select>
        <select value={rep} onChange={(e) => setRep(e.target.value)} aria-label="Rep filter">
          <option value="all">All reps</option>
          {reps.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
        <select value={minHeat} onChange={(e) => setMinHeat(Number(e.target.value))} aria-label="Heat filter">
          <option value={0}>Any heat</option>
          <option value={8}>🔥 Hot (8+)</option>
          <option value={5}>Warm (5+)</option>
        </select>
        {selectedState && (
          <span className="badge stale" style={{ cursor: "pointer" }} onClick={() => setSelectedState("")}>
            {STATE_NAMES[selectedState] || selectedState} ✕
          </span>
        )}
      </div>

      <div className="map-layout">
        <div className="card" style={{ padding: 10 }}>
          <LeadMap
            pins={pins}
            selectedState={selectedState}
            onSelectState={(st) => { setSelectedState(st); setSelectedLeadId(""); }}
            selectedLeadId={selectedLeadId}
            onSelectLead={(id) => {
              setSelectedLeadId(id);
              const p = pins.find((x) => x.id === id);
              if (p) setSelectedState(p.geo!.state);
            }}
            mapsApiKey={data.mapsApiKey}
          />
          <div className="map-legend">
            <span><i style={{ background: heatColor("9") }} /> Hot (8–10)</span>
            <span><i style={{ background: heatColor("6") }} /> Warm (5–7)</span>
            <span><i style={{ background: heatColor("2") }} /> Cool / unrated</span>
            <span><i style={{ background: heatColor("2"), opacity: 0.45 }} /> State-level guess</span>
            <span className="muted" style={{ marginLeft: "auto" }}>Pin size = est. $ value</span>
          </div>
          {!data.mapsApiKey && (
            <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
              Built-in atlas view. Add a <code>GOOGLE_MAPS_API_KEY</code> in Netlify to switch this
              page to Google Maps (streets, zoom, satellite).
            </div>
          )}
        </div>

        <div className="card">
          {selectedState ? (
            <>
              <h2 style={{ marginTop: 0 }}>
                {STATE_NAMES[selectedState] || selectedState}
                <span className="muted" style={{ fontFamily: "var(--sans)", fontSize: 13.5, fontWeight: 400 }}>
                  {" "}— {stateLeads.length} lead{stateLeads.length === 1 ? "" : "s"} ·{" "}
                  {fmtMoney(stateLeads.reduce((s, p) => s + pinValue(p), 0))} est.
                </span>
              </h2>
              <div className="map-lead-list">
                {stateLeads.map((p) => (
                  <div
                    key={p.id}
                    className={`map-lead${p.id === selectedLeadId ? " active" : ""}`}
                    onClick={() => setSelectedLeadId(p.id)}
                  >
                    <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                      <span className="dot" style={{ background: heatColor(p.score) }} />
                      <strong>{p.name}</strong>
                      <span className="spacer" />
                      <span className="muted">{p.value || ""}</span>
                    </div>
                    <div className="muted" style={{ fontSize: 12.5 }}>
                      {p.geo!.place}
                      {p.geo!.precision !== "city" && ` (~${p.geo!.precision})`}
                      {p.headline && ` · ${p.headline.slice(0, 60)}`}
                    </div>
                    <a
                      className="open-link"
                      onClick={(e) => { e.stopPropagation(); router.push(`/leads/${encodeURIComponent(p.id)}`); }}
                    >
                      Open lead →
                    </a>
                  </div>
                ))}
                {!stateLeads.length && <div className="muted">No pinned leads here with these filters.</div>}
              </div>
            </>
          ) : (
            <>
              <h2 style={{ marginTop: 0 }}>Focus areas</h2>
              <p className="muted" style={{ fontSize: 13, marginTop: 4 }}>
                Where the pipeline is. Click a region (or a state on the map) to plan a trip around it.
              </p>
              <div className="map-lead-list">
                {regions.map((r) => (
                  <div key={r.st} className="map-lead" onClick={() => setSelectedState(r.st)}>
                    <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                      <strong>{STATE_NAMES[r.st] || r.st}</strong>
                      <span className="spacer" />
                      <span>{r.count}</span>
                      <span className="muted">{fmtMoney(r.value)}</span>
                    </div>
                  </div>
                ))}
                {!regions.length && <div className="muted">No pinned leads with these filters.</div>}
              </div>
            </>
          )}

          {unlocated.length > 0 && (
            <div style={{ marginTop: 12, borderTop: "1px solid var(--line)", paddingTop: 8 }}>
              <a className="open-link" onClick={() => setShowUnlocated((v) => !v)}>
                {showUnlocated ? "Hide" : "Show"} {unlocated.length} leads without a location
              </a>
              {showUnlocated && (
                <div className="map-lead-list" style={{ marginTop: 6 }}>
                  {unlocated.map((l) => (
                    <div key={l.id} className="map-lead" onClick={() => router.push(`/leads/${encodeURIComponent(l.id)}`)}>
                      <strong>{l.name}</strong>
                      <div className="muted" style={{ fontSize: 12.5 }}>
                        {(l.headline || l.pianoType || "—").slice(0, 70)}
                      </div>
                    </div>
                  ))}
                  <div className="muted" style={{ fontSize: 12 }}>
                    Tip: add a city + state to the lead&apos;s headline or notes ("… in Provo, UT") and
                    it will appear on the map.
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
