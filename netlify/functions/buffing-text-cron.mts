/**
 * Korban's buffing text (Walter 10/7) — workdays at 11:00 AM Denver, when his
 * 8–11 tunings end and buffing starts:
 * the top plate screws (Curtis's order) and the top visible hardware to prep
 * (furthest along first), with a link to the buffing list in the Store Map.
 *
 * OFF until the App Settings row `buffing_text` says "on" — Mark does the
 * one-time cleanup of the list first, then the switch is flipped on the
 * Settings page. `buffing_text_to` overrides who gets it (default Korban).
 * Skipped on days when both lists are empty.
 *
 * The cron fires at 17:00 and 18:00 UTC so one of them is 11:00 Denver in
 * both MDT and MST; the other returns at once. 11 AM is inside the 10–4
 * quiet-hours window, so the text goes out normally.
 */
import { buffingText } from "./buffing-list.mts";
import { loadSettings } from "./app-settings.mts";

export default async () => {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", hour12: false,
    hour: "2-digit", weekday: "short" }).formatToParts(now);
  const hour = Number(parts.find(x => x.type === "hour")?.value || -1);
  const wd = parts.find(x => x.type === "weekday")?.value || "";
  if (hour !== 11 || wd === "Sat" || wd === "Sun") return;
  let st: Record<string, string> = {};
  try { st = (await loadSettings()).settings; } catch { return; }   // no settings → never guess "on"
  if (!/^(on|yes|true|1)$/i.test(String(st.buffing_text || "").trim())) return;
  const to = String(st.buffing_text_to || "Korban").trim() || "Korban";
  try {
    const msg = await buffingText();
    if (!msg) return;
    await fetch("https://blpsalesapp.netlify.app/.netlify/functions/request-notify", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: process.env.BLP_APP_ACCESS_KEY || "", name: to, message: msg }),
    });
  } catch (e) {
    console.error("buffing-text-cron:", String(e));
  }
};

export const config = { schedule: "0 17,18 * * 1-5" };
