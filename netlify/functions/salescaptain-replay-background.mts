/** Background worker (up to 15 min): paced SalesCaptain history replay. See lib/salescaptain-replay.ts.
 *  POST ?key=…&from=ISO&to=ISO   start a new replay window (noCreate), then run the first pass
 *  POST ?key=…                   continue the saved replay
 *  POST ?key=…&stop=1            mark the saved replay stopped (no further passes)
 *  A pass that ends on its time budget starts the next pass itself; a pass that
 *  stops on an error (e.g. Google's rate limit) waits to be continued by hand. */
import { getStore } from "@netlify/blobs";
import { startReplay, continueReplay, type ReplayState } from "./lib/salescaptain-replay";
import { installSheetsMeter } from "./lib/sheets-meter";
installSheetsMeter("salescaptain-replay-background");

const APP_KEY = process.env.BLP_APP_ACCESS_KEY || "pianoman";
const SITE = process.env.URL || "https://blpsalesapp.netlify.app";

export default async (req: Request) => {
  const url = new URL(req.url);
  const key = url.searchParams.get("key") || "";
  if (key !== APP_KEY) return new Response("unauthorized", { status: 403 });
  try {
    if (url.searchParams.get("stop") === "1") {
      const s = getStore({ name: "salescaptain-api", consistency: "strong" });
      const st = (await s.get("replay", { type: "json" })) as ReplayState | null;
      if (st) { st.done = true; st.stopped = "stopped by hand"; await s.setJSON("replay", st); }
      console.log("[salescaptain-replay] stopped by hand");
      return new Response("ok", { status: 200 });
    }
    const from = url.searchParams.get("from"), to = url.searchParams.get("to");
    if (from && to) {
      const st = await startReplay(Date.parse(from), Date.parse(to), url.searchParams.get("create") !== "1");
      console.log(`[salescaptain-replay] started ${st.from} → ${st.to}: ${st.convs.length} conversations`);
    }
    const r = await continueReplay();
    const t = r.state?.totals;
    console.log(`[salescaptain-replay] pass: conv ${r.state?.next}/${r.state?.convs.length} msgs ${t?.messages} posted ${t?.posted} dup ${t?.duplicates} skipped ${t?.skipped} err ${t?.errors}${r.state?.stopped ? ` stopped: ${r.state.stopped}` : ""}${r.note ? ` (${r.note})` : ""}`);
    if (r.more) {
      await fetch(`${SITE}/.netlify/functions/salescaptain-replay-background?key=${encodeURIComponent(key)}`, { method: "POST" }).catch(() => {});
    }
  } catch (e) {
    console.error("[salescaptain-replay] failed:", e);
  }
  return new Response("ok", { status: 200 });
};
