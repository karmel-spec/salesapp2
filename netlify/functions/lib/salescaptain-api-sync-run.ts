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
import { scConfigured, scAccounts, scConversationsSince, scMessagesSince, type ScMessage } from "./salescaptain-api";

const APP_URL = process.env.URL || process.env.PUBLIC_BASE_URL || "https://blpsalesapp.netlify.app";
const INTAKE_KEY = process.env.BLP_ARNOLD_ACCESS_KEY || "";
const OVERLAP_MS = 15 * 60_000;

export interface SyncOptions { since?: number; noCreate?: boolean; dryRun?: boolean; cap?: number }
export interface SyncReport {
  ok: boolean; seeded?: string; skipped?: string; window?: { from: string; to: string };
  conversations: number; messages: number; posted: number; duplicates: number; skippedMsgs: number; errors: number;
  samples: string[]; apiCalls: number; ms: number; at: string;
}

const channelOf = (t: string) => t === "web_chat_message" ? "webchat" : t === "fb_message" ? "facebook" : t === "ig_message" ? "instagram" : t === "email_message" ? "email" : t === "call" ? "call" : "text";

export async function runSalesCaptainApiSync(opts: SyncOptions = {}): Promise<SyncReport> {
  const t0 = Date.now();
  const base: SyncReport = { ok: true, conversations: 0, messages: 0, posted: 0, duplicates: 0, skippedMsgs: 0, errors: 0, samples: [], apiCalls: 0, ms: 0, at: new Date().toISOString() };
  if (!scConfigured()) return { ...base, ok: false, skipped: "SALESCAPTAIN_API_KEY / SALESCAPTAIN_COMPANY_ID not set" };
  if (!INTAKE_KEY) return { ...base, ok: false, skipped: "BLP_ARNOLD_ACCESS_KEY not set" };
  const store = getStore("salescaptain-api");
  const cursor = ((await store.get("cursor", { type: "json" })) as { since?: number; boundaryPage?: number } | null) || {};
  const replay = !!opts.since;
  if (!replay && !cursor.since) {
    cursor.since = Date.now();
    await store.setJSON("cursor", cursor);
    return { ...base, seeded: new Date(cursor.since).toISOString(), ms: Date.now() - t0 };
  }
  const since = replay ? opts.since! : cursor.since! - OVERLAP_MS;
  const to = Date.now();
  const accounts = await scAccounts(); base.apiCalls++;
  // The message payload does not name the sender. Best available signals:
  // the auto-reply's fixed wording, "this is <Name>" in the text, then the
  // conversation's assigned account, then a generic "BLP team".
  const REPS = "Brigham|Melissa|Lisa|Alisa|Karmel|Susie|Ezzy";
  const whoOf = (text: string, assignedTo: string | null) => {
    if (/our staff will be with you shortly|thank you for (texting|contacting) (us|brigham larson pianos)/i.test(text)) return "SalesCaptain auto-reply";
    const m = new RegExp(`\\b(?:this is|it'?s|from|[—–-])\\s*(${REPS})\\b`, "i").exec(text);
    if (m) return m[1][0].toUpperCase() + m[1].slice(1).toLowerCase();
    const a = assignedTo ? accounts.get(assignedTo) : undefined;
    if (a?.first_name && !/captain/i.test(a.first_name)) return a.first_name;
    return "BLP team";
  };
  const { list, calls, boundaryPage } = await scConversationsSince(since, opts.cap || 400, cursor.boundaryPage); base.apiCalls += calls;
  if (!opts.dryRun) { cursor.boundaryPage = boundaryPage; if (!replay) await store.setJSON("cursor", cursor); }
  base.conversations = list.length;
  base.window = { from: new Date(since).toISOString(), to: new Date(to).toISOString() };
  let newest = cursor.since || 0;

  for (const c of list) {
    let msgs: ScMessage[] = [];
    try { msgs = await scMessagesSince(c.conversation_id, since); base.apiCalls++; } catch (e) { base.errors++; base.samples.push(`ERR messages ${c.contact_name}: ${String(e).slice(0, 80)}`); continue; }
    for (const m of msgs) {
      const at = Date.parse(m.created_at);
      if (!replay && at > to) continue;
      base.messages++;
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
        backfill: replay || undefined,
        noCreate: opts.noCreate || undefined,
      };
      if (opts.dryRun) {
        base.samples.length < 60 && base.samples.push(`${m.created_at.slice(0, 16)} ${m.direction.padEnd(8)} ${(c.contact_name || c.contact_number || "?").slice(0, 22).padEnd(22)} ${payload.channel.padEnd(8)} ${text.replace(/\s+/g, " ").slice(0, 70)}${payload.media.length ? ` 📎${payload.media.length}` : ""}`);
        newest = Math.max(newest, at);
        continue;
      }
      try {
        const r = await fetch(`${APP_URL}/api/salescaptain/inbound`, { method: "POST", headers: { "content-type": "application/json", "x-blp-key": INTAKE_KEY }, body: JSON.stringify(payload) });
        const out = (await r.json().catch(() => ({}))) as { duplicate?: boolean; skipped?: string; error?: string; leadName?: string; created?: boolean; outbound?: boolean };
        if (!r.ok) { base.errors++; base.samples.length < 60 && base.samples.push(`ERR ${r.status} ${c.contact_name}: ${out.error || ""}`); continue; }
        if (out.duplicate) base.duplicates++;
        else if (out.skipped) base.skippedMsgs++;
        else { base.posted++; base.samples.length < 60 && base.samples.push(`${m.created_at.slice(0, 16)} ${m.direction} ${out.created ? "NEW " : ""}${out.leadName || c.contact_name} ← ${text.replace(/\s+/g, " ").slice(0, 60)}`); }
        newest = Math.max(newest, at);
        await new Promise((res) => setTimeout(res, out.duplicate || out.skipped ? 150 : 700)); // sheet quota
      } catch (e) { base.errors++; base.samples.length < 60 && base.samples.push(`ERR post ${c.contact_name}: ${String(e).slice(0, 80)}`); }
    }
  }
  if (!replay && !opts.dryRun) {
    // Advance only past what we fully processed; never beyond "now".
    cursor.since = base.errors ? Math.max(cursor.since || 0, since) : Math.min(to, Math.max(newest, cursor.since || 0, to - OVERLAP_MS));
    await store.setJSON("cursor", cursor);
    await store.setJSON("health", { at: new Date().toISOString(), posted: base.posted, conversations: base.conversations });
  }
  base.ms = Date.now() - t0;
  await store.setJSON(replay || opts.dryRun ? "lastReplay" : "lastRun", base);
  return base;
}
