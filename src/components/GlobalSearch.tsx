"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client";
import { looseIncludes, normalizeText } from "@/lib/search";
import type { SearchRow } from "@/app/api/search-index/route";

/**
 * Sidebar search across every lead and every field — name, phone, email,
 * address, piano, type, headline, status, rep, notes, last message. Matches
 * appear as you type (forgiving: any word order, punctuation ignored, digits
 * match phone numbers); Enter or click opens the lead.
 */

let indexCache: { rows: SearchRow[]; at: number } | null = null;
const INDEX_TTL = 5 * 60_000;

async function loadIndex(force = false): Promise<SearchRow[]> {
  if (!force && indexCache && Date.now() - indexCache.at < INDEX_TTL) return indexCache.rows;
  const r = await api<{ rows: SearchRow[] }>("/api/search-index");
  indexCache = { rows: r.rows, at: Date.now() };
  return r.rows;
}

const FIELDS: { key: keyof SearchRow; label: string }[] = [
  { key: "phone", label: "phone" },
  { key: "email", label: "email" },
  { key: "address", label: "address" },
  { key: "piano", label: "piano" },
  { key: "type", label: "type" },
  { key: "headline", label: "headline" },
  { key: "status", label: "status" },
  { key: "rep", label: "rep" },
  { key: "notes", label: "notes" },
  { key: "lastMsg", label: "last message" },
];

function haystack(r: SearchRow): string {
  return [r.name, r.headline, r.phone, r.email, r.address, r.piano, r.type, r.status, r.rep, r.notes, r.lastMsg].join(" ");
}

/** Which field matched (so the row can say "phone · (801) 555-1234"). */
function matchedField(r: SearchRow, q: string): { label: string; value: string } | null {
  if (looseIncludes(r.name, q)) return null; // the name itself matched — nothing extra to show
  for (const f of FIELDS) {
    const v = String(r[f.key] || "");
    if (v && looseIncludes(v, q)) return { label: f.label, value: v.length > 90 ? v.slice(0, 90) + "…" : v };
  }
  return null;
}

export function GlobalSearch({ className = "" }: { className?: string }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<SearchRow[] | null>(null);
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const [loading, setLoading] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const ensureIndex = () => {
    if (rows || loading) return;
    setLoading(true);
    loadIndex()
      .then(setRows)
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  };

  // "/" anywhere (outside a field) focuses the search.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
      if (e.key === "/" && !typing) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const results = useMemo(() => {
    const needle = q.trim();
    if (!rows || needle.length < 2) return [];
    const nq = normalizeText(needle);
    const hits = rows.filter((r) => looseIncludes(haystack(r), needle));
    // Name matches first (prefix before contains), then everything else, newest leads first is already the index order.
    const rank = (r: SearchRow) => {
      const n = normalizeText(r.name);
      if (n.startsWith(nq)) return 0;
      if (looseIncludes(r.name, needle)) return 1;
      if (looseIncludes(r.phone, needle) || looseIncludes(r.email, needle)) return 2;
      return 3;
    };
    return hits.sort((a, b) => rank(a) - rank(b)).slice(0, 8);
  }, [rows, q]);

  useEffect(() => setHi(0), [q]);

  const go = (r: SearchRow) => {
    setOpen(false);
    setQ("");
    router.push(`/leads/${encodeURIComponent(r.id)}`);
  };

  return (
    <div className={`gsearch${className ? ` ${className}` : ""}`} ref={wrap}>
      <input
        ref={inputRef}
        type="search"
        role="combobox"
        aria-expanded={open && results.length > 0}
        aria-label="Search the whole sales app"
        placeholder="Search anything…  /"
        value={q}
        onFocus={() => {
          ensureIndex();
          setOpen(true);
        }}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
          ensureIndex();
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setHi((h) => Math.min(h + 1, results.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHi((h) => Math.max(h - 1, 0));
          } else if (e.key === "Enter") {
            if (results[hi]) {
              e.preventDefault();
              go(results[hi]);
            } else if (q.trim()) {
              // No direct hit: hand the query to the Leads tab's own search.
              setOpen(false);
              router.push(`/leads?all=1&q=${encodeURIComponent(q.trim())}`);
            }
          } else if (e.key === "Escape") {
            setOpen(false);
            inputRef.current?.blur();
          }
        }}
      />
      {open && q.trim().length >= 2 && (
        <div className="gsearch-panel" role="listbox">
          {loading && !rows && <div className="gsearch-note">Loading the client index…</div>}
          {rows && results.length === 0 && <div className="gsearch-note">No client matches “{q.trim()}”. Press Enter to search the Leads tab.</div>}
          {results.map((r, i) => {
            const m = matchedField(r, q.trim());
            return (
              <div
                key={r.id}
                role="option"
                aria-selected={i === hi}
                className={`gsearch-row${i === hi ? " hi" : ""}`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  go(r);
                }}
                onMouseEnter={() => setHi(i)}
              >
                <div className="gsearch-top">
                  <b>{r.name || "(no name)"}</b>
                  <span className="gsearch-chip">{r.status}</span>
                  {r.rep && <span className="gsearch-chip rep">{r.rep}</span>}
                </div>
                <div className="gsearch-sub">
                  {m ? (
                    <>
                      <span className="gsearch-field">{m.label}</span> {m.value}
                    </>
                  ) : (
                    r.headline || r.piano || r.type || r.phone || r.email
                  )}
                </div>
              </div>
            );
          })}
          {rows && results.length > 0 && (
            <div className="gsearch-note">
              ↑↓ to move · Enter opens · <span className="muted-light">{rows.length} clients indexed</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
