/**
 * SalesCaptain → Sales Console, cloud-side. Read the SalesCaptain notification
 * emails in every mailbox that receives them (karmel@ gets the main-line TEXT
 * alerts; brigham@/melissa@/info@ get webchat leads) via Gmail delegation,
 * parse them, and hand each one to /api/salescaptain/inbound. The route
 * dedupes on the alert's RFC Message-ID, so the same alert reaching four
 * mailboxes (or the Mac watcher seeing it too) lands on the lead exactly once.
 *
 * Cursor (newest internalDate seen per mailbox) lives in Netlify Blobs. On the
 * first sight of a mailbox the cursor is seeded to "now" — history is imported
 * deliberately with scripts/backfill-salescaptain.ts.
 */
import { getStore } from "@netlify/blobs";
import { searchMessages, getMessage } from "./gmail-dwd";
import { parseSalesCaptainAlert } from "./salescaptain-alert";

const MAILBOXES = ["karmel@brighamlarsonpianos.com", "brigham@brighamlarsonpianos.com", "melissa@brighamlarsonpianos.com", "info@brighamlarsonpianos.com"];
const APP_URL = process.env.PUBLIC_BASE_URL || "https://blpsalesapp.netlify.app";
const INTAKE_KEY = process.env.BLP_ARNOLD_ACCESS_KEY || "";

interface Cursor { [mailbox: string]: number } // newest internalDate (ms) processed

/** One polling pass. `since` (ms) replays from that instant without moving the cursor. */
export async function runSalesCaptainPoll(opts: { since?: number } = {}) {
  if (!INTAKE_KEY) throw new Error("BLP_ARNOLD_ACCESS_KEY not set");
  const store = getStore("salescaptain-poll");
  const cursor = ((await store.get("cursor", { type: "json" })) as Cursor | null) || {};
  const sinceOverride = opts.since || 0;
  // The REST API sync is the primary path now; email alerts are the fallback.
  if (!sinceOverride) {
    const health = (await getStore("salescaptain-api").get("health", { type: "json" })) as { at?: string } | null;
    if (health?.at && Date.now() - Date.parse(health.at) < 20 * 60_000) {
      return { ok: true, total: 0, posted: 0, duplicates: 0, skipped: 0, report: { skipped: `API sync healthy at ${health.at}` }, cursor };
    }
  }
  const report: Record<string, unknown> = {};
  let total = 0, posted = 0, dupes = 0, skipped = 0;

  for (const box of MAILBOXES) {
    if (!sinceOverride && !cursor[box]) {
      // First sight of this mailbox: start from now. Anything older is a
      // deliberate backfill (scripts/backfill-salescaptain.ts or ?since=).
      cursor[box] = Date.now();
      report[box] = { seeded: new Date(cursor[box]).toISOString() };
      continue;
    }
    const since = sinceOverride || cursor[box];
    const q = `from:no-reply@salescaptain.com after:${Math.floor(since / 1000) - 60}`;
    let ids: string[] = [];
    try {
      ids = await searchMessages(box, q, 300);
    } catch (e) {
      report[box] = { error: String(e).slice(0, 200) };
      continue;
    }
    let newest = cursor[box] || 0;
    let n = 0, p = 0, d = 0, s = 0;
    for (const id of ids.reverse()) {
      let mail;
      try { mail = await getMessage(box, id); } catch (e) { s++; continue; }
      if (mail.internalDate <= (cursor[box] || 0) && !sinceOverride) continue; // already seen
      n++;
      const parsed = parseSalesCaptainAlert(mail.subject, mail.text);
      if (!parsed || (!parsed.senderName && !parsed.senderPhone)) { s++; newest = Math.max(newest, mail.internalDate); continue; }
      const res = await fetch(`${APP_URL}/api/salescaptain/inbound`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-blp-key": INTAKE_KEY },
        body: JSON.stringify({
          senderName: parsed.senderName,
          senderPhone: parsed.senderPhone,
          messageText: parsed.messageText,
          at: parsed.sentAt || new Date(mail.internalDate).toISOString(),
          channel: parsed.channel === "salescaptain" ? undefined : parsed.channel,
          photo: parsed.photo,
          sourceMessageId: mail.rfcMessageId,
          account: box,
        }),
      });
      const out = (await res.json().catch(() => ({}))) as { duplicate?: boolean; error?: string };
      if (!res.ok) { s++; continue; } // leave the cursor behind it so the next run retries
      if (out.duplicate) d++; else p++;
      newest = Math.max(newest, mail.internalDate);
    }
    if (!sinceOverride && newest > (cursor[box] || 0)) cursor[box] = newest;
    report[box] = { considered: n, posted: p, duplicates: d, skipped: s };
    total += n; posted += p; dupes += d; skipped += s;
  }
  if (!sinceOverride) await store.setJSON("cursor", cursor);
  return { ok: true, total, posted, duplicates: dupes, skipped, report, cursor };
}
