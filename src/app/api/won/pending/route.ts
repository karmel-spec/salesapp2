import { NextRequest, NextResponse } from "next/server";
import { requireSession, jsonError } from "@/lib/api";
import { listHandoffs, handoffStoreReady } from "@/lib/won";

export const dynamic = "force-dynamic";

/** Handoffs from the last 30 days still waiting on an admin or shop "Got it" (dashboard strip). */
export async function GET(req: NextRequest) {
  const guard = requireSession(req);
  if (guard) return guard;
  try {
    if (!handoffStoreReady()) return NextResponse.json({ pending: [] });
    const since = new Date(Date.now() - 30 * 864e5).toISOString();
    const rows = await listHandoffs(`created_at=gte.${since}&email_sent_at=not.is.null&or=(admin_ack_at.is.null,shop_ack_at.is.null)&order=created_at.desc&select=id,lead_id,lead_name,branch,closed_by,created_at,admin_ack_at,shop_ack_at,nudge_count`);
    return NextResponse.json({ pending: rows });
  } catch (err) {
    return jsonError(err);
  }
}
