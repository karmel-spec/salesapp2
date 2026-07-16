"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { geoAlbersUsa } from "d3-geo";
import type { MapLead } from "@/lib/geo-shared";
import { NAME_TO_ABBR } from "@/lib/geo-shared";

/**
 * The Lead Map canvas. Two renderers, same data and interactions:
 *  - GoogleLeadMap: Google Maps JS (streets/terrain/zoom) when an API key
 *    is configured (GOOGLE_MAPS_API_KEY).
 *  - UsAtlasMap: built-in SVG US atlas (Albers projection) — zero keys,
 *    works out of the box, ideal for the nationwide trip-planning view.
 */

export interface Pin extends MapLead {
  lat: number;
  lng: number;
}

export function heatColor(score: string): string {
  const n = Number(score) || 0;
  if (n >= 8) return "#9e2020"; // crimson — hot
  if (n >= 5) return "#b08a3c"; // gold — warm
  return "#33526e"; // info blue — cool / unrated
}

/** Best-effort dollar value (same rule as client.ts leadValue). */
export function pinValue(p: MapLead): number {
  const raw = (p.value || "").replace(/,/g, "").toLowerCase();
  let best = 0;
  for (const m of raw.matchAll(/(\d+(?:\.\d+)?)\s*(k)?/g)) {
    const n = Number(m[1]) * (m[2] ? 1000 : 1);
    if (n > best) best = n;
  }
  return best;
}

function pinRadius(p: MapLead): number {
  return Math.min(11, 4.5 + Math.sqrt(pinValue(p)) / 28);
}

export interface LeadMapProps {
  pins: Pin[];
  selectedState: string;
  onSelectState: (abbr: string) => void;
  selectedLeadId: string;
  onSelectLead: (id: string) => void;
  mapsApiKey: string;
}

export function LeadMap(props: LeadMapProps) {
  return props.mapsApiKey ? <GoogleLeadMap {...props} /> : <UsAtlasMap {...props} />;
}

/* ── Built-in SVG atlas ─────────────────────────────────────────────── */

interface StateFeature {
  type: string;
  properties: { name: string };
  geometry: { type: string; coordinates: unknown };
}

const VIEW_W = 975;
const VIEW_H = 610;

/**
 * Project a state's rings into an SVG path by hand. geoPath() interprets
 * GeoJSON spherically, so polygons with RFC-7946 winding render inside-out;
 * planar point-by-point projection doesn't care about winding. Points the
 * Albers-USA projection can't place (e.g. Puerto Rico) drop out naturally.
 */
function statePath(geometry: StateFeature["geometry"], projection: (c: [number, number]) => [number, number] | null): string {
  const polys =
    geometry.type === "Polygon"
      ? [geometry.coordinates as [number, number][][]]
      : geometry.type === "MultiPolygon"
        ? (geometry.coordinates as [number, number][][][])
        : [];
  let d = "";
  for (const rings of polys) {
    for (const ring of rings) {
      const pts = ring.map((c) => projection(c)).filter(Boolean) as [number, number][];
      if (pts.length < 3) continue;
      d += "M" + pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join("L") + "Z";
    }
  }
  return d;
}

function UsAtlasMap({ pins, selectedState, onSelectState, selectedLeadId, onSelectLead }: LeadMapProps) {
  const [states, setStates] = useState<StateFeature[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/us-states.json")
      .then((r) => {
        if (!r.ok) throw new Error(`US atlas failed to load (${r.status})`);
        return r.json();
      })
      .then((fc: { features: StateFeature[] }) => setStates(fc.features))
      .catch((e) => setError(e.message));
  }, []);

  // The canonical Albers-USA frame for a 975×610 canvas (fitExtent relies on
  // spherical bounds, which the winding issue above would also distort).
  const projection = useMemo(() => geoAlbersUsa().scale(1300).translate([VIEW_W / 2, VIEW_H / 2]), []);
  const project = (c: [number, number]) => projection(c);

  if (error) return <div className="banner bad">⚠ {error}</div>;
  if (!states) return <div className="spin">Loading map…</div>;

  // Big pins first so small ones stay clickable on top.
  const drawOrder = [...pins].sort((a, b) => pinRadius(b) - pinRadius(a));

  return (
    <svg
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      role="img"
      aria-label="US map of leads"
      style={{ width: "100%", height: "auto", display: "block" }}
    >
      {states.map((f) => {
        const abbr = NAME_TO_ABBR[f.properties.name.toLowerCase()] || "";
        const selected = abbr && abbr === selectedState;
        const d = statePath(f.geometry, project);
        if (!d) return null;
        return (
          <path
            key={f.properties.name}
            d={d}
            fillRule="evenodd"
            fill={selected ? "#f7e9e9" : "#f3f0ea"}
            stroke={selected ? "#9e2020" : "#cfc8bd"}
            strokeWidth={selected ? 1.6 : 0.8}
            style={{ cursor: "pointer" }}
            onClick={() => onSelectState(selected ? "" : abbr)}
          >
            <title>{f.properties.name}</title>
          </path>
        );
      })}
      {drawOrder.map((p) => {
        const xy = projection([p.lng, p.lat]);
        if (!xy) return null;
        const r = pinRadius(p);
        const active = p.id === selectedLeadId;
        return (
          <g key={p.id} style={{ cursor: "pointer" }} onClick={() => onSelectLead(p.id)}>
            <circle
              cx={xy[0]}
              cy={xy[1]}
              r={active ? r + 2 : r}
              fill={heatColor(p.score)}
              fillOpacity={p.geo?.precision === "state" ? 0.45 : 0.82}
              stroke={active ? "#121212" : "#ffffff"}
              strokeWidth={active ? 2 : 1}
            />
            <title>
              {`${p.name} — ${p.geo?.place}${p.value ? ` · ${p.value}` : ""}${p.headline ? `\n${p.headline}` : ""}`}
            </title>
          </g>
        );
      })}
    </svg>
  );
}

/* ── Google Maps renderer ───────────────────────────────────────────── */

/* Minimal typings for the parts of the Maps JS API we touch. */
/* eslint-disable @typescript-eslint/no-explicit-any */
let mapsLoader: Promise<any> | null = null;

function loadGoogleMaps(key: string): Promise<any> {
  if (!mapsLoader) {
    mapsLoader = new Promise((resolve, reject) => {
      const w = window as any;
      if (w.google?.maps) return resolve(w.google);
      const s = document.createElement("script");
      s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly`;
      s.async = true;
      s.onload = () => resolve((window as any).google);
      s.onerror = () => {
        mapsLoader = null;
        reject(new Error("Google Maps failed to load — check the API key"));
      };
      document.head.appendChild(s);
    });
  }
  return mapsLoader;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function GoogleLeadMap({ pins, selectedState, selectedLeadId, onSelectLead, mapsApiKey }: LeadMapProps) {
  const holder = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);
  const infoRef = useRef<any>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let dead = false;
    loadGoogleMaps(mapsApiKey)
      .then((google) => {
        if (dead || !holder.current || mapRef.current) return;
        mapRef.current = new google.maps.Map(holder.current, {
          center: { lat: 39.5, lng: -98.35 },
          zoom: 4,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: true,
        });
        infoRef.current = new google.maps.InfoWindow();
      })
      .catch((e) => setError(e.message));
    return () => {
      dead = true;
    };
  }, [mapsApiKey]);

  // (Re)draw markers whenever the filtered pin set changes.
  useEffect(() => {
    const google = (window as any).google;
    const map = mapRef.current;
    if (!google?.maps || !map) return;
    markersRef.current.forEach((m) => m.setMap(null));
    markersRef.current = pins.map((p) => {
      const marker = new google.maps.Marker({
        map,
        position: { lat: p.lat, lng: p.lng },
        title: `${p.name} — ${p.geo?.place || ""}`,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: pinRadius(p),
          fillColor: heatColor(p.score),
          fillOpacity: p.geo?.precision === "state" ? 0.45 : 0.85,
          strokeColor: "#ffffff",
          strokeWeight: 1.5,
        },
      });
      marker.addListener("click", () => {
        onSelectLead(p.id);
        infoRef.current?.setContent(
          `<div style="font-family:sans-serif;max-width:240px">
             <div style="font-weight:700">${esc(p.name)}</div>
             <div style="color:#555;margin:2px 0">${esc(p.headline || p.pianoType || "")}</div>
             <div style="color:#555">${esc(p.geo?.place || "")}${p.value ? ` · ${esc(p.value)}` : ""}</div>
             <a href="/leads/${encodeURIComponent(p.id)}" style="color:#9e2020">Open lead →</a>
           </div>`
        );
        infoRef.current?.open({ map, anchor: marker });
      });
      return marker;
    });
    if (pins.length) {
      const bounds = new google.maps.LatLngBounds();
      pins.forEach((p) => bounds.extend({ lat: p.lat, lng: p.lng }));
      map.fitBounds(bounds, 40);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pins, mapRef.current]);

  // Focusing a state zooms to its pins.
  useEffect(() => {
    const google = (window as any).google;
    const map = mapRef.current;
    if (!google?.maps || !map || !selectedState) return;
    const inState = pins.filter((p) => p.geo?.state === selectedState);
    if (!inState.length) return;
    const bounds = new google.maps.LatLngBounds();
    inState.forEach((p) => bounds.extend({ lat: p.lat, lng: p.lng }));
    map.fitBounds(bounds, 60);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedState]);

  // Selecting a lead in the sidebar pans to it.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedLeadId) return;
    const p = pins.find((x) => x.id === selectedLeadId);
    if (p) map.panTo({ lat: p.lat, lng: p.lng });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLeadId]);

  if (error) return <div className="banner bad">⚠ {error}</div>;
  return <div ref={holder} style={{ width: "100%", height: 560, borderRadius: 8 }} />;
}
