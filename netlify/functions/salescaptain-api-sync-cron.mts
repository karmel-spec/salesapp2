/** Every 5 minutes: kick the background SalesCaptain API sync. */
export const config = { schedule: "*/5 * * * *" };
const SITE = process.env.URL || "https://blpsalesapp.netlify.app";
const KEY = process.env.BLP_APP_ACCESS_KEY || "";

export default async () => {
  try {
    const r = await fetch(`${SITE}/.netlify/functions/salescaptain-api-sync-background?key=${encodeURIComponent(KEY)}`, { method: "POST" });
    console.log(`[salescaptain-api-sync-cron] kicked background worker → ${r.status}`);
    return new Response(JSON.stringify({ ok: true, kicked: r.status }), { status: 200, headers: { "content-type": "application/json" } });
  } catch (e) {
    console.error("[salescaptain-api-sync-cron] failed:", e);
    return new Response(String(e), { status: 500 });
  }
};
