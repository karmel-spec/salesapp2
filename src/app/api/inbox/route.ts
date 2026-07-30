import { NextRequest, NextResponse } from "next/server";
import { getLeads, getLead, markInboundRead, markAllInboundRead, setInboundFolder, archiveInbound } from "@/lib/leads";
import { listFolders } from "@/lib/folders";
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
  folder?: string;
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
    let salesUnread = 0;
    let generalUnread = 0;
    const items: InboxItem[] = [];
    // Closed-out clients (won/closed/lost/inactive/unqualified) drop out of
    // the inbox and its unread counts — the quick status toggle files them.
    const CLOSED = new Set(["won", "closed", "lost", "inactive", "unqualified"]);
    const salesFolders = new Set(
      (await listFolders().catch(() => [])).filter((f) => f.tab === "sales").map((f) => f.name.toLowerCase())
    );
    if (!salesFolders.size) salesFolders.add("leads");
    for (const l of leads) {
      if (CLOSED.has(l.statusBucket)) continue;
      for (const e of l.timeline) {
        if (e.kind !== "inbound" || e.archivedAt) continue;
        if (!e.readAt) {
          unread++;
          if (salesFolders.has((e.folder || "").toLowerCase())) salesUnread++;
          else generalUnread++;
        }
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
          folder: e.folder || "",
        });
      }
    }
    if (req.nextUrl.searchParams.get("count") === "1") {
      return NextResponse.json({ unread, salesUnread, generalUnread });
    }
    const t = (s: string) => {
      const d = new Date(s);
      return isNaN(d.getTime()) ? 0 : d.getTime();
    };
    items.sort((a, b) => t(b.at) - t(a.at));
    return NextResponse.json({ unread, salesUnread, generalUnread, items: items.slice(0, 200) });
  } catch (err) {
    return jsonError(err);
  }
}

/**
 * Acknowledge client replies as read — or flip them back to unread.
 * Body: { who, leadId, ats: [iso…] } for one lead, or { who, all: true }.
 * Add { unread: true } to clear the read mark instead of setting it.
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
    // Close out / reopen ("Done" ⇄ back to the inbox).
    if (typeof body.archive === "boolean") {
      const changed = await archiveInbound(found.lead, found.shape, ats, who, body.archive);
      return NextResponse.json({ changed });
    }
    // File into a folder ("" = back to the general inbox).
    if (typeof body.folder === "string") {
      const changed = await setInboundFolder(found.lead, found.shape, ats, body.folder.trim());
      return NextResponse.json({ changed });
    }
    const changed = await markInboundRead(found.lead, found.shape, ats, who, body.unread !== true);
    return NextResponse.json({ changed });
  } catch (err) {
    return jsonError(err);
  }
}
