// Scheduled: saturday Friday-report reminder (one of two UTC slots; the
// Denver wall-clock gate inside runReminder picks the right one per DST).
import type { Config } from "@netlify/functions";
import { runReminder } from "./lib/report-reminders";

export default async () => {
  const out = await runReminder("saturday");
  console.log("[report-reminder] " + out);
  return new Response(out);
};

export const config: Config = { schedule: "0 19 * * 6" };
