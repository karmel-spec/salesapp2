/** Background worker (up to 15 min): one SalesCaptain API sync pass.
 *  POST /.netlify/functions/salescaptain-api-sync-background?key=…[&since=ISO][&noCreate=1][&dry=1][&cap=N] */
import { runSalesCaptainApiSync } from "./lib/salescaptain-api-sync-run";

const APP_KEY = process.env.BLP_APP_ACCESS_KEY || "pianoman";

export default async (req: Request) => {
  const url = new URL(req.url);
  if (url.searchParams.get("key") !== APP_KEY) return new Response("unauthorized", { status: 403 });
  const sinceRaw = url.searchParams.get("since");
  const since = sinceRaw ? Date.parse(sinceRaw) : undefined;
  try {
    const r = await runSalesCaptainApiSync({ since: since || undefined, noCreate: url.searchParams.get("noCreate") === "1", dryRun: url.searchParams.get("dry") === "1", cap: Number(url.searchParams.get("cap") || 0) || undefined });
    console.log(`[salescaptain-api-sync] conv ${r.conversations} msgs ${r.messages} posted ${r.posted} dup ${r.duplicates} skipped ${r.skippedMsgs} err ${r.errors} in ${r.ms}ms${r.seeded ? ` (seeded ${r.seeded})` : ""}`);
  } catch (e) {
    console.error("[salescaptain-api-sync] failed:", e);
  }
  return new Response("ok", { status: 200 });
};
