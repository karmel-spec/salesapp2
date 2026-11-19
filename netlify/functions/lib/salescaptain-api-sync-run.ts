/**
 * SalesCaptain → Sales Console over the REST API (replaces email-alert
 * parsing as the primary path). Every message — inbound AND outbound, texts,
 * webchat, social, calls — is handed to /api/salescaptain/inbound, which
 * matches the lead by phone/name, dedupes on the SalesCaptain message_id
 * (and on content+time against anything the email path already logged),
 * fills in missing phone numbers, and marks inbound read when a rep replied.
 *
 * Cursor: Netlify Blobs store "salescaptain-api" → "cursor" {since}. First
 * run seeds to now; history is a deliberate replay (?since=…&noCreate=1).
 */
import { getStore } from "@netlify/blobs";
import { scConfigured, scAccounts, scConversationsSince, scMessagesSince, type ScMessage, type ScConversation } from "./salescaptain-api";

const APP_URL = process.env.URL || process.env.PUBLIC_BASE_URL || "https://blpsalesapp.netlify.app";
const INTAKE_KEY = process.env.BLP_ARNOLD_ACCESS_KEY || "";
const OVERLAP_MS = 15 * 60_000;
// Guards added 11/18 after the sync sat stuck from 10/2 to 11/18: its cursor
// was 7 weeks old, every 5-minute run replayed ~160 messages, got killed at
// the 15-minute background limit before saving the cursor, and started over —
// each replayed message cost a full Leads Log read (most of the Sheets quota).
const MAX_AUTO_WINDOW_MS = 6 * 3600_000; // a scheduled run never reaches back further; older = recorded gap
const RUN_BUDGET_MS = 10 * 60_000;       // stop well inside Netlify's 15-minute background limit
const LOCK_TTL_MS = 14 * 60_000;         // one run at a time (a crashed run's lock expires)
const MAX_ERRORS = 3;                    // stop early instead of hammering a struggling app/Sheets

export interface SyncOptions { since?: number; noCreate?: boolean; dryRun?: boolean; cap?: number }
export interface SyncReport {
  ok: boolean; seeded?: string; skipped?: string; window?: { from: string; to: string };
  conversations: number; messages: number; posted: number; duplicates: number; skippedMsgs: number; errors: number;
  samples: string[]; apiCalls: number; ms: number; at: string;
}

const channelOf = (t: string) => t === "web_chat_message" ? "webchat" : t === "fb_message" ? "facebook" : t === "ig_message" ? "instagram" : t === "email_message" ? "email" : t === "call" ? "call" : "text";

// The message payload does not name the sender. Best available signals:
// the auto-reply's fixed wording, "this is <Name>" in the text, then the
// conversation's assigned account, then a generic "BLP team".
// Only an EXPLICIT personal sign-on counts as a named rep ("this is Melissa at
// the piano shop", "- Brigham"). "This is Brigham Larson Pianos…" is the
// company, not Brigham — those reminders/campaigns are "BLP team", which keeps
// BL Client Responses limited to replies to Brigham's own outreach.
const REPS = "Brigham|Melissa|Lisa|Alisa|Karmel|Susie|Ezzy";
export const whoOf = (text: string, _assignedTo: string | null): string => {
  if (/our staff will be with you shortly|thank you for (texting|contacting) (us|brigham larson pianos)|outside of our (working|business) hours/i.test(text)) return "SalesCaptain auto-reply";
  const t = text.replace(/Brigham Larson Pianos/gi, "BLP");
  const m =
    new RegExp(`\\b(?:this is|it'?s|hey,? it'?s)\\s+(${REPS})\\b(?!\\s+Larson\\s+Pianos)`, "i").exec(t) ||
    new RegExp(`\\b(${REPS})\\s+(?:here|at the (piano )?shop|from (the )?(piano )?shop|with BLP)\\b`, "i").exec(t) ||
    new RegExp(`(?:^|\\n|[—–-]\\s*)(${REPS})\\s*$`, "i").exec(t.trim());
  if (m) return m[1][0].toUpperCase() + m[1].slice(1).toLowerCase();
  return "BLP team";
};

/** The /api/salescaptain/inbound body for one SalesCaptain message. */
export function messagePayload(c: ScConversation, m: ScMessage, o: { backfill?: boolean; noCreate?: boolean }) {
  const isCall = m.type_of_message === "call";
  const dur = m.call_duration ? Number(m.call_duration) : 0;
  const text = isCall
    ? `📞 ${m.direction === "inbound" ? "Incoming" : "Outgoing"} call${m.call_status ? ` · ${m.call_status}` : ""}${dur ? ` · ${Math.round(dur / 60)}m ${dur % 60}s` : ""}${m.recording_url ? `\n🎧 ${m.recording_url}` : ""}`
    : (m.message || "").trim();
  const payload = {
    senderName: (c.contact_name || "").trim(),
    senderPhone: c.contact_number || "",
    senderEmail: c.contact_email || "",
    messageText: text,
    at: m.created_at,
    channel: channelOf(m.type_of_message),
    direction: m.direction,
    who: m.direction === "outbound" ? whoOf(text, c.assigned_to) : undefined,
    media: (m.media || []).filter((u) => typeof u === "string"),
    salesCaptainMessageId: m.message_id,
    salesCaptainContactId: c.contact_id,
    salesCaptainConversationId: c.conversation_id,
    backfill: o.backfill || undefined,
    noCreate: o.noCreate || undefined,
  };
  return { text, payload };
}

export async function runSalesCaptainApiSync(opts: SyncOptions = {}): Promise<SyncReport> {
  const t0 = Date.now();
  const base: SyncReport = { ok: true, conversations: 0, messages: 0, posted: 0, duplicates: 0, skippedMsgs: 0, errors: 0, samples: [], apiCalls: 0, ms: 0, at: new Date().toISOString() };
  if (!scConfigured()) return { ...base, ok: false, skipped: "SALESCAPTAIN_API_KEY / SALESCAPTAIN_COMPANY_ID not set" };
  if (!INTAKE_KEY) return { ...base, ok: false, skipped: "BLP_ARNOLD_ACCESS_KEY not set" };
  const store = getStore({ name: "salescaptain-api", consistency: "strong" });
  const replay = !!opts.since;
  // One run at a time: overlapping runs replayed the same messages in parallel.
  const runId = `${t0}-${Math.random().toString(36).slice(2, 8)}`;
  if (!opts.dryRun) {
    const lock = (await store.get("lock", { type: "json" }).catch(() => null)) as { at?: number; id?: string } | null;
    if (lock?.at && t0 - lock.at < LOCK_TTL_MS) {
      return { ...base, skipped: `another sync run has been active since ${new Date(lock.at).toISOString()}`, ms: Date.now() - t0 };
    }
    await store.setJSON("lock", { at: t0, id: runId });
  }
  try {
    return await syncPass(store, base, opts, replay, t0);
  } finally {
    if (!opts.dryRun) {
      const lock = (await store.get("lock", { type: "json" }).catch(() => null)) as { id?: string } | null;
      if (lock?.id === runId) await store.delete("lock").catch(() => {});
    }
  }
}

async function syncPass(store: ReturnType<typeof getStore>, base: SyncReport, opts: SyncOptions, replay: boolean, t0: number): Promise<SyncReport> {
  const cursor = ((await store.get("cursor", { type: "json" })) as { since?: number; boundaryPage?: number } | null) || {};
  if (!replay && !cursor.since) {
    cursor.since = Date.now();
    await store.setJSON("cursor", cursor);
    return { ...base, seeded: new Date(cursor.since).toISOString(), ms: Date.now() - t0 };
  }
  if (!replay && Date.now() - cursor.since! > MAX_AUTO_WINDOW_MS) {
    // Too far behind for a scheduled pass to catch up. Record the gap for a
    // deliberate, paced replay (?since=…&noCreate=1) and resume from now.
    const gapTo = Date.now() - MAX_AUTO_WINDOW_MS;
    const gaps = ((await store.get("gaps", { type: "json" }).catch(() => null)) as { from: string; to: string; recordedAt: string }[] | null) || [];
    gaps.push({ from: new Date(cursor.since!).toISOString(), to: new Date(gapTo).toISOString(), recordedAt: new Date().toISOString() });
    await store.setJSON("gaps", gaps);
    console.warn(`[salescaptain-api-sync] cursor ${new Date(cursor.since!).toISOString()} is too old — gap recorded, resuming from ${new Date(gapTo).toISOString()}`);
    cursor.since = gapTo;
    await store.setJSON("cursor", cursor);
  }
  const since = replay ? opts.since! : cursor.since! - OVERLAP_MS;
  const to = Date.now();
  const accounts = await scAccounts(); base.apiCalls++;
  void accounts;
  const { list, calls, boundaryPage } = await scConversationsSince(since, opts.cap || 400, cursor.boundaryPage); base.apiCalls += calls;
  if (!opts.dryRun) { cursor.boundaryPage = boundaryPage; if (!replay) await store.setJSON("cursor", cursor); }
  base.conversations = list.length;
  base.window = { from: new Date(since).toISOString(), to: new Date(to).toISOString() };
  let newest = cursor.since || 0;

  let stopped = "";
  for (const c of list) {
    if (stopped) break;
    if (Date.now() - t0 > RUN_BUDGET_MS) { stopped = "time budget"; break; }
    let msgs: ScMessage[] = [];
    try { msgs = await scMessagesSince(c.conversation_id, since); base.apiCalls++; } catch (e) { base.errors++; base.samples.push(`ERR messages ${c.contact_name}: ${String(e).slice(0, 80)}`); continue; }
    for (const m of msgs) {
      if (base.errors >= MAX_ERRORS) { stopped = `${base.errors} errors`; break; }
      const at = Date.parse(m.created_at);
      if (!replay && at > to) continue;
      base.messages++;
      const { text, payload } = messagePayload(c, m, { backfill: replay, noCreate: opts.noCreate });
      if (opts.dryRun) {
        base.samples.length < 60 && base.samples.push(`${m.created_at.slice(0, 16)} ${m.direction.padEnd(8)} ${(c.contact_name || c.contact_number || "?").slice(0, 22).padEnd(22)} ${payload.channel.padEnd(8)} ${text.replace(/\s+/g, " ").slice(0, 70)}${payload.media.length ? ` 📎${payload.media.length}` : ""}`);
        newest = Math.max(newest, at);
        continue;
      }
      try {
        const r = await fetch(`${APP_URL}/api/salescaptain/inbound`, { method: "POST", headers: { "content-type": "application/json", "x-blp-key": INTAKE_KEY }, body: JSON.stringify(payload) });
        const out = (await r.json().catch(() => ({}))) as { duplicate?: boolean; skipped?: string; error?: string; leadName?: string; created?: boolean; outbound?: boolean };
        if (!r.ok) {
          base.errors++;
          base.samples.length < 60 && base.samples.push(`ERR ${r.status} ${c.contact_name}: ${(out.error || "").slice(0, 160)}`);
          // Google's per-minute Sheets quota is shared by every BLP app: back off, don't push through.
          if (/429|too many reads|quota/i.test(out.error || "")) { stopped = "Sheets rate limit"; break; }
          continue;
        }
        if (out.duplicate) base.duplicates++;
        else if (out.skipped) base.skippedMsgs++;
        else { base.posted++; base.samples.length < 60 && base.samples.push(`${m.created_at.slice(0, 16)} ${m.direction} ${out.created ? "NEW " : ""}${out.leadName || c.contact_name} ← ${text.replace(/\s+/g, " ").slice(0, 60)}`); }
        newest = Math.max(newest, at);
        await new Promise((res) => setTimeout(res, out.duplicate || out.skipped ? 150 : 1400)); // Sheets quota: a posted message costs a read + a write
      } catch (e) { base.errors++; base.samples.length < 60 && base.samples.push(`ERR post ${c.contact_name}: ${String(e).slice(0, 80)}`); }
    }
  }
  if (stopped) { base.samples.push(`STOPPED early: ${stopped}`); console.warn(`[salescaptain-api-sync] stopped early: ${stopped}`); }
  if (!replay && !opts.dryRun) {
    // Advance only past what we fully processed; never beyond "now".
    cursor.since = base.errors || stopped ? Math.max(cursor.since || 0, since) : Math.min(to, Math.max(newest, cursor.since || 0, to - OVERLAP_MS));
    await store.setJSON("cursor", cursor);
    await store.setJSON("health", { at: new Date().toISOString(), posted: base.posted, conversations: base.conversations });
  }
  base.ms = Date.now() - t0;
  await store.setJSON(replay || opts.dryRun ? "lastReplay" : "lastRun", base);
  return base;
}
