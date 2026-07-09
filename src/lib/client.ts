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

/** The signed-in rep's name (chosen in the sidebar, kept per device). */
export function getWho(): string {
  if (typeof window === "undefined") return "app";
  return localStorage.getItem("blp_rep_name") || "app";
}
