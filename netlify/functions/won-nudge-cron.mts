/** Every 30 minutes: remind admin / the shop about WON handoffs nobody has acknowledged (2h grace, max 3 reminders). */
export const config = { schedule: "*/30 * * * *" };
const SITE = process.env.URL || "https://blpsalesapp.netlify.app";
const KEY = process.env.BLP_APP_ACCESS_KEY || "";

export default async () => {
  try {
    const r = await fetch(`${SITE}/api/won/nudge?key=${encodeURIComponent(KEY)}`);
    const j = await r.json().catch(() => ({}));
    console.log(`[won-nudge] ${r.status} nudged ${j.nudged ?? "?"}`);
    return new Response(JSON.stringify(j), { status: 200, headers: { "content-type": "application/json" } });
  } catch (e) {
    console.error("[won-nudge] failed:", e);
    return new Response(String(e), { status: 500 });
  }
};
