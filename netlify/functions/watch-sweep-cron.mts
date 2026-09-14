/** Once a day (9:00 AM Mountain): wake leads whose "snooze until a piano is
 *  available" watch now matches the Piano Log. */
export const config = { schedule: "0 15 * * *" };
const SITE = process.env.URL || "https://blpsalesapp.netlify.app";
const KEY = process.env.BLP_APP_ACCESS_KEY || "";

export default async () => {
  try {
    const r = await fetch(`${SITE}/api/watch/sweep?key=${encodeURIComponent(KEY)}`);
    const j = await r.json().catch(() => ({}));
    console.log(`[watch-sweep] ${r.status} checked ${j.checked} woke ${j.woke?.length ?? "?"}`);
    return new Response(JSON.stringify(j), { status: 200, headers: { "content-type": "application/json" } });
  } catch (e) {
    console.error("[watch-sweep] failed:", e);
    return new Response(String(e), { status: 500 });
  }
};
