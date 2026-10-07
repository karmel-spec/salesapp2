/**
 * Store Map — bridge queue drain, BACKGROUND edition (Walter 10/7). Same work
 * as bridge-queue-worker, but a background function may run for minutes, so
 * each queued piano-log write gets a 30 s budget — long enough for the slow
 * bridge to answer, so a write that landed is marked done instead of being
 * re-sent every 5 minutes. Called by bridge-queue-worker-cron.
 */
import { drainQueue } from "./bridge-queue-worker.mts";

export default async (req: Request) => {
  const url = new URL(req.url);
  if ((url.searchParams.get("key") || "") !== (process.env.BLP_APP_ACCESS_KEY || "")) return;
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) return;
  const res = await drainQueue(30000, 6);
  if (res.drained || res.gaveUp) console.log("bridge-queue-worker-background:", JSON.stringify(res));
};
