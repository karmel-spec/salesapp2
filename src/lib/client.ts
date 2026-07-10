"use client";

import type { Lead } from "./leads";

/** Client-side fetch helpers. Cookies carry the session automatically. */
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  const json = await res.json().catch(() => ({}));
  if (res.status === 401 && typeof window !== "undefined") {
    window.location.href = "/login";
  }
  if (!res.ok) throw new Error((json as { error?: string }).error || `Request failed (${res.status})`);
  return json as T;
}

export async function fetchLeads(refresh = false) {
  return api<{ leads: Lead[]; writeEnabled: boolean }>(`/api/leads${refresh ? "?refresh=1" : ""}`);
}

export const REPS = ["Brigham", "Karmel", "Arnold", "Melissa", "Alisa"] as const;

/** Canonical pick-lists for lead fields (free-text history stays as "keep current"). */
export const LEAD_SOURCES = ["Repeat customer", "Google", "YouTube", "TikTok", "Facebook", "Instagram", "Sign", "Referral", "Recital", "KSL", "Not sure"];
export const INQUIRY_METHODS = ["Text", "Phone Call", "Voicemail", "Email", "Web Form", "Walk-in", "Social Media", "SC - Text"];
export const PIANO_TYPES = ["Upright", "Tall Upright", "Grand", "Baby Grand", "Spinet", "Console", "Player Piano", "Digital", "Heirloom / family piano"];
export const LEAD_TYPES = ["Sales", "Restoration", "Player Restoration", "Refinishing", "Refurbishing", "QRS", "Trade-in Sales Lead"];
export const ENTERED_BY = ["Brigham", "Karmel", "Melissa", "Susie", "Alisa"];

/** The signed-in rep's name (chosen in the sidebar, kept per device). */
export function getWho(): string {
  if (typeof window === "undefined") return "app";
  return localStorage.getItem("blp_rep_name") || "app";
}

/* ── Lead priority order (Karmel, 2026-07-10) ─────────────────────────────
   1 New → 2 Hot (9-10) → 3 Restoration → 4 other shop work → 5 Hailun sales
   → 6 other sales. Within a category: $ value high→low, then heat, then
   grands before uprights. */

function leadText(l: Lead): string {
  return `${l.leadType} ${l.pianoType} ${l.headline}`.toLowerCase();
}

export function priorityCategory(l: Lead): number {
  if (l.statusBucket === "new") return 0;
  if (Number(l.score) >= 9) return 1;
  const s = leadText(l);
  if (/restor|rebuild|player/.test(s)) return 2;
  if (/refinish|refurb|repair|qrs/.test(s)) return 3;
  if (/hailun/.test(s)) return 4;
  return 5;
}

export const PRIORITY_CATEGORY_LABELS = [
  "New", "Hot (9–10)", "Restoration", "Shop work", "Hailun", "Other sales",
];

/** Best-effort dollar value ("$5-15k" → 15000, "7500" → 7500). */
export function leadValue(l: Lead): number {
  const raw = (l.value || "").replace(/,/g, "").toLowerCase();
  let best = 0;
  for (const m of raw.matchAll(/(\d+(?:\.\d+)?)\s*(k)?/g)) {
    const n = Number(m[1]) * (m[2] ? 1000 : 1);
    if (n > best) best = n;
  }
  return best;
}

function grandRank(l: Lead): number {
  const s = leadText(l);
  if (/grand/.test(s)) return 0;
  if (/upright|spinet|console|vertical/.test(s)) return 1;
  return 2;
}

/** Sort a lead list by the team's working-priority rules. */
export function prioritySort(leads: Lead[]): Lead[] {
  return [...leads].sort((a, b) =>
    priorityCategory(a) - priorityCategory(b) ||
    leadValue(b) - leadValue(a) ||
    (Number(b.score) || 0) - (Number(a.score) || 0) ||
    grandRank(a) - grandRank(b)
  );
}
