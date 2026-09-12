/** Manual control for the SalesCaptain API sync.
 *  GET ?key=…&status=1                → cursor, health, last run, last replay
 *  GET ?key=…[&since=ISO][&noCreate=1][&dry=1][&cap=N] → kicks a background pass (202), read results with status=1 */
import { getStore } from "@netlify/blobs";

const APP_KEY = process.env.BLP_APP_ACCESS_KEY || "pianoman";
const SITE = process.env.URL || "https://blpsalesapp.netlify.app";
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o, null, 1), { status, headers: { "content-type": "application/json" } });

export default async (req: Request) => {
  const url = new URL(req.url);
  if (url.searchParams.get("key") !== APP_KEY) return json({ error: "unauthorized" }, 403);
  const store = getStore("salescaptain-api");
  if (url.searchParams.get("status") === "1") {
    const [cursor, health, lastRun, lastReplay] = await Promise.all(["cursor", "health", "lastRun", "lastReplay"].map((k) => store.get(k, { type: "json" })));
    return json({ cursor, health, lastRun, lastReplay });
  }
  if (url.searchParams.get("reset") === "1") { await store.delete("cursor"); return json({ ok: true, reset: true }); }
  const qs = new URLSearchParams();
  for (const k of ["since", "noCreate", "dry", "cap"]) { const v = url.searchParams.get(k); if (v) qs.set(k, v); }
  qs.set("key", APP_KEY);
  const r = await fetch(`${SITE}/.netlify/functions/salescaptain-api-sync-background?${qs}`, { method: "POST" });
  return json({ ok: r.status < 300, kicked: r.status, note: "running in the background — poll ?status=1 for lastRun / lastReplay" }, 202);
};
