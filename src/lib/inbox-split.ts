import type { Lead, TimelineEvent } from "./leads";

/**
 * Who is a customer reply actually answering? The rep whose outreach (text,
 * email, or call) was the most recent thing we sent that lead before the
 * reply came in. Returns "" for cold first-contact inquiries (webchat, a
 * text to the main line, a SalesCaptain lead) where nobody had reached out.
 *
 * Drives the two inboxes: "BL Client Responses" = replies to Brigham;
 * "Client Responses" = everything else.
 */
const OUTREACH_KINDS = new Set(["sms_out", "email_out", "call", "call_attempt"]);
/** Automated or anonymous actors — not a person the customer is replying to. */
const NOT_A_REP = /^(app|phone|plaud|twilio|team|arnold(-api)?|)$/i;

export const BRIGHAM = "Brigham";

function eventTime(iso: string): number {
  const t = new Date(iso).getTime();
  return isNaN(t) ? 0 : t;
}

/** Name of the rep this inbound reply responds to, or "" if it's cold. */
export function replyTarget(lead: Lead, reply: TimelineEvent): string {
  const replyAt = eventTime(reply.at);
  let best: { at: number; who: string } | null = null;
  for (const e of lead.timeline) {
    if (!OUTREACH_KINDS.has(e.kind)) continue;
    const at = eventTime(e.at);
    if (!at || at >= replyAt) continue;
    // Console sends record the human as `who`; automated sends (who = "app")
    // still name the author in the text ("— written by Brigham").
    let who = (e.who || "").trim();
    if (NOT_A_REP.test(who)) {
      const m = (e.text || "").match(/(?:written|approved|sent) by ([A-Z][a-z]+)/);
      who = m ? m[1] : "";
    }
    if (!who || NOT_A_REP.test(who)) continue;
    if (!best || at > best.at) best = { at, who };
  }
  return best?.who || "";
}

/** True when this inbound reply is a direct response to Brigham's outreach. */
export function isBrighamReply(lead: Lead, reply: TimelineEvent): boolean {
  return replyTarget(lead, reply).toLowerCase() === BRIGHAM.toLowerCase();
}

export type InboxScope = "brigham" | "others";

/** Does this reply belong in the given inbox? */
export function inScope(lead: Lead, reply: TimelineEvent, scope: InboxScope | undefined): boolean {
  if (!scope) return true;
  return isBrighamReply(lead, reply) === (scope === "brigham");
}
