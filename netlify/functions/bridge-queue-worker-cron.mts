/**
 * Every 5 minutes: drain queued piano-log writes so any op that Google's
 * bridge glitched on lands within minutes — no change is ever lost.
 */
export default async () => {
  const key = process.env.BLP_APP_ACCESS_KEY || "";
  try {
    const r = await fetch(
      "https://blpsalesapp.netlify.app/.netlify/functions/bridge-queue-worker?key=" + encodeURIComponent(key),
    );
    const j = await r.json().catch(() => ({}));
    if ((j as { drained?: number }).drained || (j as { gaveUp?: number }).gaveUp) {
      console.log("bridge-queue-worker:", JSON.stringify(j));
    }
  } catch (e) {
    console.error("bridge-queue-worker-cron failed:", String(e));
  }
};

export const config = { schedule: "*/5 * * * *" };
