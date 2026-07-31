// Scheduled: Friday 4:00 PM team cleaning report email (MDT slot; the
// Denver wall-clock gate inside runCleaningReport picks the right one).
import type { Config } from "@netlify/functions";
import { runCleaningReport } from "./lib/report-reminders";

export default async () => {
  const out = await runCleaningReport();
  console.log("[cleaning-report] " + out);
  return new Response(out);
};

export const config: Config = { schedule: "0 22 * * 5" };
