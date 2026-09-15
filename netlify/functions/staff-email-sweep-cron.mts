/** Daily 6:30 AM Mountain: kick the background staff-email sweep (3-day look-back). */
export const config = { schedule: "30 12 * * *" };
const SITE = process.env.URL || "https://blpsalesapp.netlify.app";
const KEY = process.env.BLP_APP_ACCESS_KEY || "";

export default async () => {
  try {
    const r = await fetch(`${SITE}/.netlify/functions/staff-email-sweep-background?key=${encodeURIComponent(KEY)}&days=3`, { method: "POST" });
    console.log(`[staff-email-sweep-cron] kicked → ${r.status}`);
    return new Response(JSON.stringify({ ok: true, kicked: r.status }), { status: 200, headers: { "content-type": "application/json" } });
  } catch (e) {
    console.error("[staff-email-sweep-cron] failed:", e);
    return new Response(String(e), { status: 500 });
  }
};
