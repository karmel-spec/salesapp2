/** Friday 5:00 PM Mountain: text Brigham his week in sales streaks. */
export const config = { schedule: "0 23 * * 5" };
const SITE = process.env.URL || "https://blpsalesapp.netlify.app";
const KEY = process.env.BLP_APP_ACCESS_KEY || "";
const fmt = (d: string) => new Date(d + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });

export default async () => {
  try {
    const r = await fetch(`${SITE}/api/streak?who=Brigham&fresh=1&key=${encodeURIComponent(KEY)}`);
    const s = (await r.json()) as { streak: number; thisWeek: { leadsWorked: number; perfectTens: number; daysWorked: number }; bestWeek: { leadsWorked: number; weekStart: string } | null; best: { count: number; date: string } | null; speed: { streak: number; weekFast: number; weekInbound: number } };
    if (!r.ok) throw new Error(`streak ${r.status}`);
    const w = s.thisWeek;
    const record = s.bestWeek && w.leadsWorked > s.bestWeek.leadsWorked;
    const parts = [
      `Week recap: ${w.leadsWorked} lead${w.leadsWorked === 1 ? "" : "s"} worked over ${w.daysWorked} day${w.daysWorked === 1 ? "" : "s"}${w.perfectTens ? `, ${w.perfectTens} Perfect Ten${w.perfectTens === 1 ? "" : "s"}` : ""}.`,
      record ? `NEW BEST WEEK (old best ${s.bestWeek!.leadsWorked}, week of ${fmt(s.bestWeek!.weekStart)}).` : s.bestWeek ? `Best week ever: ${s.bestWeek.leadsWorked} (week of ${fmt(s.bestWeek.weekStart)}).` : "",
      `Streak: ${s.streak} business day${s.streak === 1 ? "" : "s"}${s.streak >= 5 ? " 🔥" : ""}.`,
      s.speed.weekInbound ? `Speed: ${s.speed.weekFast} of ${s.speed.weekInbound} customer messages answered within the hour${s.speed.streak ? ` (${s.speed.streak}-day lightning streak)` : ""}.` : "",
      s.best ? `Best single day: ${s.best.count} (${fmt(s.best.date)}).` : "",
      "Weekend doesn't count against you. See you Monday. 💪",
    ].filter(Boolean);
    const message = parts.join(" ").slice(0, 600);
    const n = await fetch(`${SITE}/.netlify/functions/request-notify`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ key: KEY, name: "Brigham", message, now: true }) });
    const out = await n.json().catch(() => ({}));
    console.log(`[friday-recap] ${message} → ${n.status} ${JSON.stringify(out).slice(0, 120)}`);
    return new Response(JSON.stringify({ ok: n.ok, message, out }), { status: 200, headers: { "content-type": "application/json" } });
  } catch (e) {
    console.error("[friday-recap] failed:", e);
    return new Response(String(e), { status: 500 });
  }
};
