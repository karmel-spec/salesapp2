/** Manual/diagnostic run of the SalesCaptain poller.
 *  GET /.netlify/functions/salescaptain-poll-now?key=<BLP app key>[&since=<ISO>]
 *  `since` replays from that instant (dedupe makes it safe) without moving the cursor. */
import { runSalesCaptainPoll } from "./lib/salescaptain-poll-run";

const APP_KEY = process.env.BLP_APP_ACCESS_KEY || "pianoman";
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o, null, 1), { status, headers: { "content-type": "application/json" } });

export default async (req: Request) => {
  const url = new URL(req.url);
  if (url.searchParams.get("key") !== APP_KEY) return json({ error: "unauthorized" }, 403);
  const sinceRaw = url.searchParams.get("since");
  const since = sinceRaw ? Date.parse(sinceRaw) : 0;
  if (sinceRaw && !since) return json({ error: "since must be an ISO date" }, 400);
  try {
    return json(await runSalesCaptainPoll(since ? { since } : {}));
  } catch (e) {
    return json({ error: String(e).slice(0, 300) }, 500);
  }
};
