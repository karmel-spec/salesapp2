import { NextRequest, NextResponse } from "next/server";
import { getLeads, getLead, markInboundRead, markAllInboundRead } from "@/lib/leads";
import { requireSession, jsonError } from "@/lib/api";

export const dynamic = "force-dynamic";

export interface InboxItem {
  leadId: string;
  leadName: string;
  headline: string;
  at: string;
  who: string;
  text: string;
  read: boolean;
  readBy?: string;
  readAt?: string;
}

/**
 * The client-response inbox: every inbound customer reply across all leads,
 * newest first, with read/unread state. The Shell's alert pill polls this
 * (?count=1) for the unread badge.
 */
export async function GET(req: NextRequest) {
  const guard = requireSession(req);
  if (guard) return guard;
  try {
    const { leads } = await getLeads(req.nextUrl.searchParams.get("refresh") === "1");
    let unread = 0;
    const items: InboxItem[] = [];
    for (const l of leads) {
      for (const e of l.timeline) {
        if (e.kind !== "inbound") continue;
        if (!e.readAt) unread++;
        items.push({
          leadId: l.id,
          leadName: l.name,
          headline: l.headline || l.leadType || "",
          at: e.at,
          who: e.who,
          text: e.text,
          read: Boolean(e.readAt),
          readBy: e.readBy,
          readAt: e.readAt,
        });
      }
    }
    if (req.nextUrl.searchParams.get("count") === "1") {
      return NextResponse.json({ unread });
    }
    const t = (s: string) => {
      const d = new Date(s);
      return isNaN(d.getTime()) ? 0 : d.getTime();
    };
    items.sort((a, b) => t(b.at) - t(a.at));
    return NextResponse.json({ unread, items: items.slice(0, 200) });
  } catch (err) {
    return jsonError(err);
  }
}

/**
 * Acknowledge client replies as read.
 * Body: { who, leadId, ats: [iso…] } for one lead, or { who, all: true }.
 */
export async function POST(req: NextRequest) {
  const guard = requireSession(req);
  if (guard) return guard;
  try {
    const body = await req.json();
    const who = (body.who || "team").toString();
    if (body.all === true) {
      const changed = await markAllInboundRead(who);
      return NextResponse.json({ changed });
    }
    const found = await getLead(String(body.leadId || ""));
    if (!found) return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    const ats = Array.isArray(body.ats) ? body.ats.map(String) : [];
    if (!ats.length) return NextResponse.json({ error: "ats[] required" }, { status: 400 });
    const changed = await markInboundRead(found.lead, found.shape, ats, who);
    return NextResponse.json({ changed });
  } catch (err) {
    return jsonError(err);
  }
}
