/** Daily 6:30 AM Mountain: log staff emails (info@/brigham@/melissa@/alisa@/lisa@ ↔ lead addresses) onto lead timelines. */
export const config = { schedule: "30 12 * * *" };
const SITE = process.env.URL || "https://blpsalesapp.netlify.app";
const KEY = process.env.BLP_APP_ACCESS_KEY || "";

export default async () => {
  try {
    const r = await fetch(`${SITE}/api/sweep/staff-email?key=${encodeURIComponent(KEY)}&days=3`);
    const j = await r.json().catch(() => ({}));
    console.log(`[staff-email-sweep] ${r.status} recent ${j.recentMessages} leads touched ${j.leadsTouched} events ${j.eventsAdded} written ${j.written}${j.errors?.length ? " errors " + j.errors.join(" | ") : ""}`);
    return new Response(JSON.stringify(j), { status: 200, headers: { "content-type": "application/json" } });
  } catch (e) {
    console.error("[staff-email-sweep] failed:", e);
    return new Response(String(e), { status: 500 });
  }
};
