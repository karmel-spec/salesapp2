// Scheduled: 7:50 AM standup text to the managers (MDT slot; the Denver
// wall-clock gate inside runStandupText picks the right one).
import type { Config } from "@netlify/functions";
import { runStandupText } from "./lib/standup-text";

export default async () => {
  const out = await runStandupText();
  console.log("[standup-text] " + out);
  return new Response(out);
};

export const config: Config = { schedule: "50 13 * * 1-5" };
