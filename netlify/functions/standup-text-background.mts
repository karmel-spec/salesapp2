/** 7:50 AM standup text — the send, run in the background (15 min, no retry).
 * runStandupText has the Denver 7:40–7:59 gate, weekday/holiday skips and the
 * claim-the-day duplicate check. */
import { runStandupText } from "./lib/standup-text";
export default async () => {
  try { console.log("[standup-text] " + await runStandupText()); }
  catch (e) { console.error("[standup-text]", String(e)); }
};
