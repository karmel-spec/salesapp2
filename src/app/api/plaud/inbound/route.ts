import { NextRequest, NextResponse } from "next/server";
import { getLeads, appendTimeline, type Lead } from "@/lib/leads";
import { notifyTelegram, notifyArnoldWebhook } from "@/lib/arnold";
import { isValidArnoldKey } from "@/lib/auth";
import { jsonError } from "@/lib/api";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Plaud call recordings → lead timelines. The watcher on Karmel's Mac polls
 * the Plaud CLI for freshly processed recordings and POSTs each summary here.
 *
 * Lead matching, strongest first:
 *  1. Console-initiated call: a timeline "call" event within ±15 min of the
 *     recording start — the console knows exactly who was called.
 *  2. Phone hint (if the recording metadata carries one).
 *  3. Name scan: a lead's full name appearing in the title/summary text.
 * Unmatched recordings ping Telegram for a manual attach.
 */
export async function POST(req: NextRequest) {
  if (!isValidArnoldKey(req.headers.get("x-blp-key"))) {
    return NextResponse.json({ error: "Invalid or missing x-blp-key" }, { status: 401 });
  }
  try {
    const input = (await req.json()) as {
      recordingId?: string;
      title?: string;
      startedAt?: string; // ISO
      durationSec?: number;
      summary?: string;
      transcriptExcerpt?: string;
      phoneHint?: string;
    };
    const summary = (input.summary || "").trim();
    if (!input.recordingId || !summary) {
      return NextResponse.json({ error: "recordingId and summary are required" }, { status: 400 });
    }

    const { leads, shape } = await getLeads(true);
    const started = input.startedAt ? Date.parse(input.startedAt) : NaN;

    let lead: Lead | undefined;
    let how = "";

    // 1. Match a console-logged call near the recording start time.
    if (!Number.isNaN(started)) {
      const WINDOW = 15 * 60 * 1000;
      let best: { lead: Lead; delta: number } | null = null;
      for (const l of leads) {
        for (const ev of l.timeline) {
          if (ev.kind !== "call") continue;
          const delta = Math.abs(Date.parse(ev.at) - started);
          if (!Number.isNaN(delta) && delta <= WINDOW && (!best || delta < best.delta)) {
            best = { lead: l, delta };
          }
        }
      }
      if (best) {
        lead = best.lead;
        how = `console call ${Math.round(best.delta / 60000)}m from recording start`;
      }
    }

    // 2. Phone hint.
    if (!lead && input.phoneHint) {
      const digits = input.phoneHint.replace(/\D/g, "").slice(-10);
      if (digits.length === 10) {
        lead = leads.find((l) => l.phoneDialable.endsWith(digits));
        if (lead) how = "phone match";
      }
    }

    // 3. Lead name mentioned in the title, summary, or transcript. The
    //    transcript is the workhorse — customers are greeted by name on the
    //    call even when the AI summary never names them. Normalize away
    //    punctuation/line breaks so "Darren,\nBalls" or "Darren's" still hit.
    if (!lead) {
      const norm = (s: string) => ` ${s.toLowerCase().replace(/[^a-z]+/g, " ")} `;
      const haystack = norm(`${input.title || ""} ${summary} ${input.transcriptExcerpt || ""}`);
      lead = leads.find(
        (l) =>
          l.firstName &&
          l.lastName &&
          haystack.includes(norm(`${l.firstName} ${l.lastName}`).slice(1, -1))
      );
      if (lead) how = "name match";
      // Last resort: a first name that is UNIQUE across open leads, spoken
      // in the call and paired with the last name somewhere in the text.
      if (!lead) {
        const open = leads.filter((l) => l.statusBucket === "new" || l.statusBucket === "active");
        const candidates = open.filter((l) => {
          if (!l.firstName || l.firstName.length < 4 || !l.lastName || l.lastName.length < 4) return false;
          const first = ` ${l.firstName.toLowerCase()} `;
          const last = ` ${l.lastName.toLowerCase()} `;
          return haystack.includes(first) && haystack.includes(last);
        });
        if (candidates.length === 1) {
          lead = candidates[0];
          how = "first+last name spoken";
        }
      }
    }

    const mins = input.durationSec ? Math.round(input.durationSec / 60) : null;

    if (!lead) {
      notifyTelegram(
        `📞 <b>Plaud call with no matching lead</b>${input.title ? ` — "${input.title}"` : ""}` +
          `${mins ? ` (${mins} min)` : ""}\nSummary: ${summary.slice(0, 350)}\n` +
          `→ If this was a lead call, open the lead and paste the summary as a Call activity.`
      ).catch(() => {});
      return NextResponse.json({ matched: false });
    }

    await appendTimeline(
      lead,
      shape,
      {
        at: input.startedAt || new Date().toISOString(),
        who: "Plaud",
        kind: "call",
        text:
          `📞 Call summary${mins ? ` (${mins} min)` : ""}${input.title ? ` — "${input.title}"` : ""}:\n` +
          `${summary.slice(0, 1500)}${input.transcriptExcerpt ? `\n\nTranscript excerpt: ${input.transcriptExcerpt.slice(0, 400)}` : ""}\n` +
          `(Plaud recording ${input.recordingId} — full transcript in the Plaud app)`,
      },
      { touchLastContact: true }
    );
    notifyTelegram(
      `📞 <b>Call summary filed</b> → ${lead.name} (${how})${mins ? ` · ${mins} min` : ""}\n${summary.slice(0, 300)}`
    ).catch(() => {});
    notifyArnoldWebhook({
      event: "followup_instruction",
      lead: { id: lead.id },
      note:
        `A phone call with ${lead.name} was just summarized (Plaud): "${summary.slice(0, 500)}". ` +
        `Update your pending drafts for this lead to reflect what was discussed.`,
    }).catch(() => {});

    return NextResponse.json({ matched: true, leadId: lead.id, leadName: lead.name, how });
  } catch (err) {
    return jsonError(err);
  }
}
