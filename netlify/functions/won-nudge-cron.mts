/** Business mornings at ~9:30 Mountain (16:30 UTC; 15:30 UTC in MDT would be 9:30 — 16:30 keeps it inside the morning year-round):
 *  remind whoever still hasn't pressed "Got it" on a WON handoff — one reminder per role per 24h, weekdays only, never on holidays. */
export const config = { schedule: "30 16 * * 1-5" };
const SITE = process.env.URL || "https://blpsalesapp.netlify.app";
const KEY = process.env.BLP_APP_ACCESS_KEY || "";

export default async () => {
  try {
    const r = await fetch(`${SITE}/api/won/nudge?key=${encodeURIComponent(KEY)}`);
    const j = await r.json().catch(() => ({}));
    console.log(`[won-nudge] ${r.status} ${j.day} businessDay=${j.businessDay} nudged ${j.nudged ?? "?"}`);
    return new Response(JSON.stringify(j), { status: 200, headers: { "content-type": "application/json" } });
  } catch (e) {
    console.error("[won-nudge] failed:", e);
    return new Response(String(e), { status: 500 });
  }
};
