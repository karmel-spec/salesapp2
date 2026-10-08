/**
 * Piano Log → Supabase read mirror: the SYNC (phase 1, 2026-10-07).
 *
 * POST/GET ?key=<BLP_APP_ACCESS_KEY>&source=cron|write|sheet-change|manual
 * Reads the whole Piano Log tab through the service account, parses it with
 * the one shared parser (lib/pianolog-parse.cjs), upserts rows whose content
 * changed, removes rows whose serial vanished, and writes a sync_runs row.
 * Serials with a bridge_queue write still queued are left untouched.
 *
 * Runs as a Netlify BACKGROUND function (202 at once, up to 15 min): called
 * every 3 min by pianolog-sync-cron, after every pianolog-write / queue
 * drain, and by the sheet's onChange trigger in the Apps Script bridge.
 * Overlapping calls skip (sync_begin lock) instead of racing.
 */
import { runSync } from "./lib/pianolog-mirror.mts";

export default async (req: Request) => {
  const url = new URL(req.url);
  if ((url.searchParams.get("key") || "") !== (process.env.BLP_APP_ACCESS_KEY || "")) return;
  const source = (url.searchParams.get("source") || "manual").slice(0, 40);
  await runSync(source);
};
