/**
 * Preview the out-on-Thursday report reminders without sending anything:
 *   GET ?key=<app key>&day=YYYY-MM-DD&hour=14|10  → {plan, notes}
 */
import { KEY } from "./_blp-sched-lib.mts";
import { absencePlan } from "./lib/absence-reminders.mts";

export default async (req: Request) => {
  const u = new URL(req.url);
  if ((u.searchParams.get("key") || "") !== KEY()) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
  const day = u.searchParams.get("day") || "";
  const hour = Number(u.searchParams.get("hour") || 14);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return new Response(JSON.stringify({ error: "day=YYYY-MM-DD" }), { status: 400 });
  return new Response(JSON.stringify(await absencePlan(day, hour), null, 1), { headers: { "content-type": "application/json" } });
};
