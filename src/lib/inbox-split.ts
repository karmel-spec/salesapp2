import type { Lead, TimelineEvent } from "./leads";
import { autoFolder } from "./folders";

/**
 * Who is a customer reply actually answering? The rep whose outreach (text,
 * email, or call) was the most recent thing we sent that lead before the
 * reply came in. Returns "" for cold first-contact inquiries (webchat, a
 * text to the main line, a SalesCaptain lead) where nobody had reached out.
 *
 * Drives the two inboxes: "BL Client Responses" = replies to Brigham;
 * "Sales Responses" = replies to the rest of the team's SALES outreach; service replies route to New Inquiries.
 */
const OUTREACH_KINDS = new Set(["sms_out", "email_out", "call", "call_attempt"]);
/** Automated or anonymous actors — not a person the customer is replying to. */
const NOT_A_REP = /^(app|phone|plaud|twilio|team|arnold(-api)?|salescaptain( auto-reply)?|)$/i;

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

/**
 * Three inboxes, every inbound message lands in exactly one:
 *  brigham — direct replies to Brigham's outreach
 *  new     — cold first-contact inquiries nobody has answered yet
 *  others  — replies to the rest of the team's outreach
 */
export type InboxScope = "brigham" | "new" | "others";

/** True when nobody at BLP had reached out before this message arrived. */
export function isNewInquiry(lead: Lead, reply: TimelineEvent): boolean {
  return replyTarget(lead, reply) === "";
}

/**
 * Service folder a reply belongs to: "tuning" | "moving" | "" (sales / general).
 * Uses the filed folder when it's a real one, else reads the lead and the
 * conversation (a move confirmation, a tuning reminder…).
 */
export function serviceFolderOf(lead: Lead, reply: TimelineEvent): "tuning" | "moving" | "" {
  const filed = (reply.folder || "").trim().toLowerCase();
  if (filed === "tuning" || filed === "moving") return filed;
  const lt = (lead.leadType || "").toLowerCase();
  if (/tun/.test(lt)) return "tuning";
  if (/mov/.test(lt)) return "moving";
  // The outreach they're answering carries the context ("your move is scheduled…").
  const replyAt = eventTime(reply.at);
  const prior = lead.timeline.filter((e) => OUTREACH_KINDS.has(e.kind) && eventTime(e.at) < replyAt).sort((a, b) => eventTime(b.at) - eventTime(a.at))[0];
  const guess = autoFolder(lead.leadType || "", lead.headline || "", `${prior?.text || ""} ${reply.text || ""}`).toLowerCase();
  return guess === "tuning" || guess === "moving" ? guess : "";
}

/** Customer-service traffic (moves, tunings, Support contacts) is never a sales response. */
export function isServiceReply(lead: Lead, reply: TimelineEvent): boolean {
  return lead.statusBucket === "support" || serviceFolderOf(lead, reply) !== "";
}

export function scopeOf(lead: Lead, reply: TimelineEvent): InboxScope {
  const target = replyTarget(lead, reply);
  if (!target) return "new";
  if (target.toLowerCase() === BRIGHAM.toLowerCase()) return "brigham";
  // Replies to the team's SERVICE outreach (move/tuning confirmations, Support
  // contacts) go to New Inquiries → Tuning/Moving/Customer Service, not Sales Responses.
  if (isServiceReply(lead, reply)) return "new";
  return "others";
}

/** Does this reply belong in the given inbox? */
export function inScope(lead: Lead, reply: TimelineEvent, scope: InboxScope | undefined): boolean {
  if (!scope) return true;
  return scopeOf(lead, reply) === scope;
}
