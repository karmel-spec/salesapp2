"use client";

import { useEffect, useMemo, useState } from "react";
import type { Lead } from "@/lib/leads";
import { api, getWho } from "@/lib/client";

/**
 * Dashboard card: Plaud call recordings the matcher couldn't attach to a
 * lead. Two clicks files one — pick the lead, hit Attach. Dismiss drops
 * calls that weren't lead calls (supplier, personal, …).
 */

interface UnfiledItem {
  recordingId: string;
  receivedAt: string;
  startedAt: string;
  title: string;
  durationSec: number | null;
  summary: string;
}

export function UnfiledCalls({ leads }: { leads: Lead[] }) {
  const [items, setItems] = useState<UnfiledItem[] | null>(null);
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string>("");
  const [flash, setFlash] = useState("");

  useEffect(() => {
    api<{ items: UnfiledItem[] }>("/api/plaud/unfiled")
      .then((r) => setItems(r.items))
      .catch(() => setItems([])); // quiet — the card just doesn't render
  }, []);

  const options = useMemo(() => {
    const open = leads.filter((l) => l.statusBucket === "new" || l.statusBucket === "active");
    const rest = leads.filter((l) => !(l.statusBucket === "new" || l.statusBucket === "active"));
    const label = (l: Lead) => `${l.name}${l.headline ? ` — ${l.headline.slice(0, 40)}` : ""}`;
    const byName = (a: Lead, b: Lead) => a.name.localeCompare(b.name);
    return { open: open.sort(byName).map((l) => ({ id: l.id, label: label(l) })), rest: rest.sort(byName).map((l) => ({ id: l.id, label: label(l) })) };
  }, [leads]);

  async function resolve(rec: UnfiledItem, action: "attach" | "dismiss") {
    const leadId = picks[rec.recordingId];
    if (action === "attach" && !leadId) return;
    setBusy(rec.recordingId);
    try {
      const r = await api<{ leadName?: string }>("/api/plaud/unfiled", {
        method: "POST",
        body: JSON.stringify({ recordingId: rec.recordingId, action, leadId, who: getWho() }),
      });
      setItems((cur) => (cur ? cur.filter((x) => x.recordingId !== rec.recordingId) : cur));
      setFlash(action === "attach" ? `✓ Filed to ${r.leadName}` : "Dismissed");
      setTimeout(() => setFlash(""), 4000);
    } catch (e) {
      setFlash(`⚠ ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy("");
    }
  }

  if (!items || items.length === 0) return null;

  return (
    <div className="card" style={{ marginBottom: 16, borderColor: "var(--gold)" }}>
      <h2>
        📼 Unfiled call recordings{" "}
        <span className="muted" style={{ fontFamily: "var(--sans)", fontWeight: 400, fontSize: 13 }}>
          — Plaud calls that didn&apos;t match a lead. Pick who it was, hit Attach.
        </span>
      </h2>
      {flash && <div className="banner info">{flash}</div>}
      {items.map((rec) => {
        const d = new Date(rec.startedAt || rec.receivedAt);
        const stamp = isNaN(d.getTime())
          ? ""
          : d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) +
            " · " +
            d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
        const mins = rec.durationSec ? `${Math.round(rec.durationSec / 60)} min` : "";
        return (
          <div key={rec.recordingId} className="unfiled-row">
            <div className="unfiled-meta">
              <strong>{rec.title || "Untitled recording"}</strong>
              <span className="muted"> {[stamp, mins].filter(Boolean).join(" · ")}</span>
            </div>
            <div className="unfiled-summary muted">{rec.summary.slice(0, 220)}{rec.summary.length > 220 ? "…" : ""}</div>
            <div className="unfiled-actions">
              <select
                value={picks[rec.recordingId] || ""}
                onChange={(e) => setPicks((p) => ({ ...p, [rec.recordingId]: e.target.value }))}
                aria-label="Attach to lead"
              >
                <option value="">— pick the lead this call was with</option>
                <optgroup label="Open leads">
                  {options.open.map((o) => (
                    <option key={o.id} value={o.id}>{o.label}</option>
                  ))}
                </optgroup>
                <optgroup label="Everyone else">
                  {options.rest.map((o) => (
                    <option key={o.id} value={o.id}>{o.label}</option>
                  ))}
                </optgroup>
              </select>
              <button
                className="btn small"
                disabled={!picks[rec.recordingId] || busy === rec.recordingId}
                onClick={() => resolve(rec, "attach")}
              >
                {busy === rec.recordingId ? "Filing…" : "Attach"}
              </button>
              <button
                className="btn small ghost"
                disabled={busy === rec.recordingId}
                onClick={() => resolve(rec, "dismiss")}
                title="Not a lead call — remove from this list"
              >
                ✕ Not a lead call
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
