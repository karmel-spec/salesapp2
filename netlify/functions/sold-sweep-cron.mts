/**
 * Below SOLD means Delivered (Walter 10/13): every 15 min, 6 AM–9 PM Denver,
 * ask the bridge to set CURRENT PHASE = Delivered on any Piano Log row that was
 * dragged below the SOLD divider by hand and still carries another phase
 * (For Sale, Exit Prep - Admin, …). The bridge does the reading and writing
 * (soldSweep_ in DailyReport.gs) and logs each one as "Phase auto-set"; rows
 * whose serial also sits above the divider are only reported. Nothing to do →
 * no writes. Apps Script answers a POST with a 302 to the result, so follow it.
 */
import { BRIDGE, KEY, denver } from "./_blp-sched-lib.mts";

export default async () => {
  const h = denver().h;
  if (!(h >= 6 && h < 21)) return;
  try {
    const r = await fetch(BRIDGE, {
      method: "POST", redirect: "follow", signal: AbortSignal.timeout(25000),
      headers: { "content-type": "text/plain" },
      body: JSON.stringify({ pin: KEY(), key: KEY(), action: "soldsweep" }),
    });
    const j = await r.json().catch(() => null) as { changed?: unknown[]; twins?: unknown[]; error?: string } | null;
    if (j && j.changed && j.changed.length) console.log("sold-sweep: set Delivered on", JSON.stringify(j.changed));
    if (j && j.error) console.error("sold-sweep:", j.error);
  } catch (e) {
    console.error("sold-sweep-cron:", String(e));   // next run tries again
  }
};

export const config = { schedule: "*/15 * * * *" };
