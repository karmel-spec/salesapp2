/** Every 5 minutes: pull new SalesCaptain alerts into the console. Netlify
 *  does not serve scheduled functions over HTTP — use salescaptain-poll-now
 *  for a manual run. Logic lives in lib/salescaptain-poll-run.ts. */
import { runSalesCaptainPoll } from "./lib/salescaptain-poll-run";

export const config = { schedule: "*/5 * * * *" };

export default async () => {
  try {
    const r = await runSalesCaptainPoll();
    console.log(`[salescaptain-poll] considered ${r.total}, posted ${r.posted}, duplicates ${r.duplicates}, skipped ${r.skipped}`);
    return new Response(JSON.stringify(r), { status: 200, headers: { "content-type": "application/json" } });
  } catch (e) {
    console.error("[salescaptain-poll] failed:", e);
    return new Response(String(e), { status: 500 });
  }
};
