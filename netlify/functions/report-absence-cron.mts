/**
 * Weekly-report reminders for people out on Thursday (Walter 10/15) — see
 * lib/absence-reminders.mts. Runs every hour; only 2 PM weekdays (heads-up on
 * the last workday before the absence) and 10 AM Thursday (follow-up) do
 * anything, in Denver time.
 */
import { denver } from "./_blp-sched-lib.mts";
import { sendAbsenceReminders } from "./lib/absence-reminders.mts";

export default async () => {
  const n = denver();
  if (!((n.h === 14 && ["Mon", "Tue", "Wed", "Thu", "Fri"].includes(n.weekday)) || (n.h === 10 && n.weekday === "Thu"))) return;
  const day = `${n.y}-${String(n.m).padStart(2, "0")}-${String(n.d).padStart(2, "0")}`;
  try {
    const r = await sendAbsenceReminders(day, n.h);
    console.log("report-absence-cron", day, n.h, JSON.stringify({ sent: r.sent, failed: r.failed, notes: r.notes }));
  } catch (e) { console.error("report-absence-cron:", String(e)); }
};

export const config = { schedule: "0 * * * *" };
