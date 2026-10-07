"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/client";

interface Pending { id: string; lead_id: string; lead_name: string; branch: string; closed_by: string; created_at: string; admin_ack_at: string | null; shop_ack_at: string | null; nudge_count: number }

/** Nav strip: WON handoffs still waiting on an admin or shop "Got it, I'm on it". Hidden when there are none. */
export function HandoffStrip() {
  const [items, setItems] = useState<Pending[]>([]);
  useEffect(() => {
    let alive = true;
    const load = () => api<{ pending: Pending[] }>("/api/won/pending").then((r) => { if (alive) setItems(r.pending || []); }).catch(() => {});
    load();
    const t = setInterval(load, 5 * 60_000);
    return () => { alive = false; clearInterval(t); };
  }, []);
  if (!items.length) return null;
  const hours = (iso: string) => Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 3600e3));
  return (
    <div className="handoff-strip">
      ⏳ <b>{items.length} handoff{items.length === 1 ? "" : "s"}</b> waiting on a "Got it":{" "}
      {items.slice(0, 4).map((p, i) => (
        <span key={p.id}>{i ? " · " : ""}<Link href={`/leads/${encodeURIComponent(p.lead_id)}`}>{p.lead_name}</Link> ({[!p.admin_ack_at && "admin", !p.shop_ack_at && "shop"].filter(Boolean).join(" + ")}, {hours(p.created_at)}h)</span>
      ))}
      {items.length > 4 && ` · +${items.length - 4} more`}
    </div>
  );
}
