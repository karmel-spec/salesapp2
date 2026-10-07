/** Once a day (9:00 AM Mountain): wake leads whose "snooze until a piano is
 *  available" watch now matches the Piano Log, then run the Non-Responsive rule. */
export const config = { schedule: "0 15 * * *" };
const SITE = process.env.URL || "https://blpsalesapp.netlify.app";
const KEY = process.env.BLP_APP_ACCESS_KEY || "";

export default async () => {
  try {
    const r = await fetch(`${SITE}/api/watch/sweep?key=${encodeURIComponent(KEY)}`);
    const j = await r.json().catch(() => ({}));
    console.log(`[watch-sweep] ${r.status} checked ${j.checked} woke ${j.woke?.length ?? "?"}`);
    // Same daily pass: Arnold's leads with 3+ unanswered attempts and 2 quiet days → Non-Responsive.
    const n = await fetch(`${SITE}/api/sweep/non-responsive?key=${encodeURIComponent(KEY)}`);
    const nj = await n.json().catch(() => ({}));
    console.log(`[non-responsive-sweep] ${n.status} moved ${nj.count ?? "?"}`);
    // WON shop projects past 50% → Brigham's upsell call lands in his Top Ten; "piano coming" rows marked arrived.
    const u = await fetch(`${SITE}/api/won/upsell-sweep?key=${encodeURIComponent(KEY)}`);
    const uj = await u.json().catch(() => ({}));
    console.log(`[upsell-sweep] ${u.status} checked ${uj.checked ?? "?"} triggered ${uj.triggered?.length ?? "?"} arrived ${uj.arrived?.length ?? "?"}`);
    return new Response(JSON.stringify({ watch: j, nonResponsive: nj, upsell: uj }), { status: 200, headers: { "content-type": "application/json" } });
  } catch (e) {
    console.error("[watch-sweep] failed:", e);
    return new Response(String(e), { status: 500 });
  }
};
