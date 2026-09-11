import { NextRequest, NextResponse } from "next/server";
import { getLeads } from "@/lib/leads";
import { requireSession, jsonError } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * Compact index for the sidebar's global search: one small row per lead
 * (every searchable field, notes trimmed) instead of the full 3 MB payload.
 */
export interface SearchRow {
  id: string;
  name: string;
  headline: string;
  phone: string;
  email: string;
  address: string;
  piano: string;
  type: string;
  status: string;
  rep: string;
  notes: string; // first 240 chars
  lastMsg: string; // newest inbound message, first 160 chars
}

export async function GET(req: NextRequest) {
  const guard = requireSession(req);
  if (guard) return guard;
  try {
    const { leads } = await getLeads(req.nextUrl.searchParams.get("refresh") === "1");
    const rows: SearchRow[] = leads.map((l) => {
      const lastIn = [...l.timeline].reverse().find((e) => e.kind === "inbound");
      return {
        id: l.id,
        name: l.name,
        headline: l.headline || "",
        phone: [l.phone, ...l.phones.map((p) => p.number)].filter(Boolean).join(" "),
        email: l.email || "",
        address: l.address || "",
        piano: l.pianoType || "",
        type: l.leadType || "",
        status: l.status || l.statusBucket,
        rep: [l.effectiveRep, l.effectiveSubRep].filter(Boolean).join(" + "),
        notes: (l.notes || "").replace(/\s+/g, " ").slice(0, 240),
        lastMsg: (lastIn?.text || "").replace(/^📥\s*/, "").replace(/\s+/g, " ").slice(0, 160),
      };
    });
    return NextResponse.json({ rows, at: new Date().toISOString() });
  } catch (err) {
    return jsonError(err);
  }
}
