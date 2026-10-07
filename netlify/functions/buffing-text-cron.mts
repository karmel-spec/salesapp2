/**
 * Korban's morning buffing text (Walter 10/7) — workdays at 7:30 AM Denver:
 * the top plate screws (Curtis's order) and the top visible hardware to prep
 * (furthest along first), with a link to the buffing list in the Store Map.
 *
 * OFF until the App Settings row `buffing_text` says "on" — Mark does the
 * one-time cleanup of the list first, then the switch is flipped on the
 * Settings page. `buffing_text_to` overrides who gets it (default Korban).
 * Skipped on days when both lists are empty.
 *
 * The cron fires at 13:30 and 14:30 UTC so one of them is 7:30 Denver in
 * both MDT and MST; the other returns at once.
 */
import { buffingText } from "./buffing-list.mts";
import { loadSettings } from "./app-settings.mts";

export default async () => {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", hour12: false,
    hour: "2-digit", weekday: "short" }).formatToParts(now);
  const hour = Number(parts.find(x => x.type === "hour")?.value || -1);
  const wd = parts.find(x => x.type === "weekday")?.value || "";
  if (hour !== 7 || wd === "Sat" || wd === "Sun") return;
  let st: Record<string, string> = {};
  try { st = (await loadSettings()).settings; } catch { return; }   // no settings → never guess "on"
  if (!/^(on|yes|true|1)$/i.test(String(st.buffing_text || "").trim())) return;
  const to = String(st.buffing_text_to || "Korban").trim() || "Korban";
  try {
    const msg = await buffingText();
    if (!msg) return;
    // now:true — a start-of-day work list, sent at the time chosen for it
    // rather than held for the 10 AM quiet-hours window
    await fetch("https://blpsalesapp.netlify.app/.netlify/functions/request-notify", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: process.env.BLP_APP_ACCESS_KEY || "", name: to, message: msg, now: true }),
    });
  } catch (e) {
    console.error("buffing-text-cron:", String(e));
  }
};

export const config = { schedule: "30 13,14 * * 1-5" };
