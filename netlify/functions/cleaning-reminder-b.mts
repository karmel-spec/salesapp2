// Scheduled: Friday 3:30 PM cleaning-assignment texts (MST slot; the
// Denver wall-clock gate inside runCleaningReminder picks the right one).
import type { Config } from "@netlify/functions";
import { runCleaningReminder } from "./lib/report-reminders";

export default async () => {
  const out = await runCleaningReminder();
  console.log("[cleaning-reminder] " + out);
  return new Response(out);
};

export const config: Config = { schedule: "30 22 * * 5" };
