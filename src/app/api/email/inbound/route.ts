import { NextRequest, NextResponse } from "next/server";
import { getLeads, appendTimeline } from "@/lib/leads";
import { notifyTelegram, notifyArnoldWebhook } from "@/lib/arnold";
import { isValidArnoldKey } from "@/lib/auth";
import { jsonError } from "@/lib/api";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Inbound email hook — the info@ reply watcher (scripts/email_reply_watcher.py
 * on Karmel's Mac) POSTs every new inbox message here. If the sender matches a
 * lead, the reply lands on the timeline (making it OUR TURN), pings the team,
 * and wakes Arnold to rewrite his pending drafts around what the customer said.
 * Non-lead senders are ignored (info@ gets plenty of non-lead mail).
 */
export async function POST(req: NextRequest) {
  if (!isValidArnoldKey(req.headers.get("x-blp-key"))) {
    return NextResponse.json({ error: "Invalid or missing x-blp-key" }, { status: 401 });
  }
  try {
    const input = (await req.json()) as {
      fromEmail?: string;
      fromName?: string;
      subject?: string;
      body?: string;
      receivedAt?: string;
    };
    const fromEmail = (input.fromEmail || "").trim().toLowerCase();
    const body = (input.body || "").trim();
    if (!fromEmail) return NextResponse.json({ error: "fromEmail is required" }, { status: 400 });

    const { leads, shape } = await getLeads(true);
    const matches = leads.filter((l) => l.emailClean.toLowerCase() === fromEmail);
    // Prefer open leads, then most recently touched.
    const lead =
      matches.find((l) => l.statusBucket === "new" || l.statusBucket === "active") ||
      matches.sort((a, b) => (b.lastTouchISO || "").localeCompare(a.lastTouchISO || ""))[0];

    if (!lead) return NextResponse.json({ matched: false });

    const excerpt = body.slice(0, 600);
    await appendTimeline(
      lead,
      shape,
      {
        at: input.receivedAt || new Date().toISOString(),
        who: lead.name,
        kind: "inbound",
        text: `📥 Customer emailed${input.subject ? ` ("${input.subject}")` : ""}: "${excerpt}${body.length > 600 ? "…" : ""}"`,
      },
      { touchLastContact: true }
    );
    notifyTelegram(
      `📥 <b>${lead.name} emailed back</b> (${lead.headline || lead.leadType || "lead"})${input.subject ? `\nSubject: ${input.subject}` : ""}:\n"${excerpt.slice(0, 400)}"\n→ It's our turn — reply from the Sales Console.`
    ).catch(() => {});
    notifyArnoldWebhook({
      event: "inbound_reply",
      lead: { id: lead.id },
      note: `Customer replied by EMAIL${input.subject ? ` (subject: "${input.subject}")` : ""}: "${excerpt}". Replace any pending drafts for this lead with new ones that respond to this message.`,
    }).catch(() => {});

    return NextResponse.json({ matched: true, leadId: lead.id, leadName: lead.name });
  } catch (err) {
    return jsonError(err);
  }
}
