import { getLeads, getLead, updateLeadFields, fitTimeline, type Lead, type TimelineEvent } from "./leads";
import { autoFolder } from "./folders";
import { searchMessageIds, getPlainMessage } from "./gmail";
import { imapConfigured, imapRecent } from "./imapmail";

/**
 * Daily staff-email sweep. Emails the team sends to (or receives from) a
 * lead's address from Gmail — info@, brigham@, melissa@, alisa@, lisa@ —
 * never passed through the console, so they were missing from timelines.
 * Every day this looks back a few days in each mailbox and logs what's new:
 * customer emails as inbound (unread if unanswered), staff emails as
 * email_out attributed by signature or mailbox. One sheet write per lead.
 */
export const SWEEP_MAILBOXES = ["info@brighamlarsonpianos.com", "brigham@brighamlarsonpianos.com", "melissa@brighamlarsonpianos.com", "alisa@brighamlarsonpianos.com", "lisa@brighamlarsonpianos.com", "brighamlarson@gmail.com"];
/** Personal Gmail has no delegation — it's read over IMAP with an app password. */
const IMAP_BOXES = new Set(["brighamlarson@gmail.com"]);
const OPEN = new Set(["new", "active", "snoozed", "support", "dormant"]);
const REPS = "Brigham|Melissa|Lisa|Alisa|Karmel|Susie|Ezzy";
const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
const twin = (tl: TimelineEvent[], at: string, body: string, kinds: string[]) => {
  const t = Date.parse(at); const key = norm(body).slice(0, 60);
  return tl.some((e) => kinds.includes(e.kind) && Math.abs(Date.parse(e.at) - t) <= 3 * 60_000 && (key.length < 3 || norm(e.text || "").includes(key)));
};

export function staffEmailEvents(l: Lead, msgs: { rfcMessageId: string; subject: string; fromAddress: string; internalDate: number; text: string }[], now = Date.now()): TimelineEvent[] {
  const addr = (l.emailClean || "").toLowerCase();
  const have = new Set(l.timeline.map((e) => (e.emailId || "").trim()).filter(Boolean));
  const out: TimelineEvent[] = [];
  const seen = new Set<string>();
  for (const m of msgs) {
    const mid = (m.rfcMessageId || "").trim();
    if (!mid || seen.has(mid) || have.has(mid)) continue;
    seen.add(mid);
    const body = m.text.split(/\n?On (Mon|Tue|Wed|Thu|Fri|Sat|Sun)(day)?,? [A-Z][a-z]{2}/)[0].replace(/\s+/g, " ").trim();
    const at = new Date(m.internalDate).toISOString();
    if (m.fromAddress === addr) {
      if (twin(l.timeline, at, body.slice(0, 80), ["inbound"])) continue;
      out.push({ at, who: l.name, kind: "inbound", source: "email", emailId: mid, emailSubject: m.subject, folder: autoFolder(l.leadType, l.headline, `${m.subject} ${body}`), text: `📥 Customer emailed${m.subject ? ` ("${m.subject}")` : ""}: "${body.slice(0, 1500)}${body.length > 1500 ? "… [truncated]" : ""}"`, ...(now - m.internalDate < 30 * 86400_000 ? {} : { readBy: "import", readAt: new Date().toISOString() }) } as TimelineEvent);
    } else if (/brighamlarsonpianos\.com$/.test(m.fromAddress) || /brighamlarson@gmail\.com$/.test(m.fromAddress)) {
      if (twin(l.timeline, at, body.slice(0, 80), ["email_out"])) continue;
      const sig = new RegExp(`\\b(${REPS})\\b`, "i").exec(body.slice(-260));
      const who = sig ? sig[1][0].toUpperCase() + sig[1].slice(1).toLowerCase() : m.fromAddress.startsWith("brigham") ? "Brigham" : m.fromAddress.startsWith("melissa") ? "Melissa" : m.fromAddress.startsWith("alisa") ? "Alisa" : m.fromAddress.startsWith("lisa") ? "Lisa" : "BLP team";
      out.push({ at, who, kind: "email_out", source: "email", emailId: mid, emailSubject: m.subject, text: `📧 Email "${m.subject}" sent from ${m.fromAddress} to ${addr} (logged by the daily email sweep): ${body.slice(0, 1500)}${body.length > 1500 ? "… [truncated]" : ""}` } as TimelineEvent);
    }
  }
  return out.sort((a, b) => a.at.localeCompare(b.at));
}

export async function runStaffEmailSweep(opts: { days?: number; dryRun?: boolean; limit?: number; box?: string; offset?: number; chunk?: number } = {}) {
  const days = opts.days ?? 3;
  const { leads, shape } = await getLeads(true);
  const pool = leads.filter((l) => OPEN.has(l.statusBucket) && l.emailClean);
  const byAddr = new Map<string, Lead[]>();
  for (const l of pool) { const a = l.emailClean.toLowerCase(); if (!byAddr.has(a)) byAddr.set(a, []); byAddr.get(a)!.push(l); }
  // One search per mailbox for ALL recent mail, then match addresses locally.
  // Chunked (box + offset) so a call stays under Netlify's route time limit;
  // the cron's background function walks the chunks.
  const boxes = opts.box ? [opts.box] : SWEEP_MAILBOXES;
  const offset = opts.offset ?? 0, chunk = opts.chunk ?? 40;
  const recent: { rfcMessageId: string; subject: string; fromAddress: string; to: string; internalDate: number; text: string }[] = [];
  const errors: string[] = [];
  let total = 0, done = true;
  for (const box of boxes) {
    try {
      if (IMAP_BOXES.has(box)) {
        if (!imapConfigured(box)) { errors.push(`${box}: not connected (app password missing)`); continue; }
        const r = await imapRecent(box, days, opts.box ? offset : 0, opts.box ? chunk : 600);
        total += r.total;
        if (opts.box && offset + chunk < r.total) done = false;
        recent.push(...r.messages.filter((m) => m.fromAddress !== "no-reply@salescaptain.com"));
        continue;
      }
      const ids = await searchMessageIds(box, `newer_than:${days}d -from:no-reply@salescaptain.com -category:promotions`, 600);
      total += ids.length;
      const slice = opts.box ? ids.slice(offset, offset + chunk) : ids;
      if (opts.box && offset + chunk < ids.length) done = false;
      for (const id of slice) { try { recent.push(await getPlainMessage(box, id)); } catch { /* skip one */ } }
    } catch (e) { errors.push(`${box}: ${String(e).slice(0, 80)}`); }
  }
  const results: { id: string; name: string; added: number; unread: number }[] = [];
  let written = 0;
  for (const [addr, ls] of byAddr) {
    const msgs = recent.filter((m) => m.fromAddress === addr || (m.to || "").toLowerCase().includes(addr));
    if (!msgs.length) continue;
    for (const l of ls) {
      const add = staffEmailEvents(l, msgs);
      if (!add.length) continue;
      results.push({ id: l.id, name: l.name, added: add.length, unread: add.filter((e) => e.kind === "inbound" && !e.readAt).length });
      if (opts.dryRun) continue;
      const fresh = (await getLead(l.id, true))?.lead || l;
      const ids = new Set(fresh.timeline.map((e) => e.emailId).filter(Boolean));
      const add2 = add.filter((e) => !(e.emailId && ids.has(e.emailId)));
      if (!add2.length) continue;
      const lines = add2.map((e) => `[${new Date(e.at).toLocaleDateString("en-US")} ${e.who} · ${e.kind}] ${e.text}`).join("\n");
      await updateLeadFields(fresh, shape, { timelineJson: JSON.stringify(fitTimeline([...fresh.timeline, ...add2])), appActivity: fresh.appActivity ? `${fresh.appActivity}\n${lines}` : lines });
      written++;
      await new Promise((r) => setTimeout(r, 1200));
      if (opts.limit && written >= opts.limit) break;
    }
  }
  return { days, box: opts.box || "all", offset, chunk, total, done, nextOffset: done ? null : offset + chunk, recentMessages: recent.length, leadsWithEmail: pool.length, leadsTouched: results.length, eventsAdded: results.reduce((s, r) => s + r.added, 0), written, dryRun: !!opts.dryRun, results, errors };
}
