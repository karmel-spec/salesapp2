/**
 * Below SOLD means Delivered (Walter 10/13): hourly, 6 AM–9 PM Denver, kick
 * the bridge sweep that sets CURRENT PHASE = Delivered on rows dragged below
 * the SOLD divider. The work runs in sold-sweep-background (Walter 10/16):
 * this function only hands it off, so Netlify never kills and retries it.
 */
import { denver } from "./_blp-sched-lib.mts";
import { kick } from "./lib/kick";

export default async (req: Request) => {
  const h = denver().h;
  if (!(h >= 6 && h < 21)) return new Response("outside hours");
  return new Response(await kick(req, "sold-sweep-background"));
};
export const config = { schedule: "5 * * * *" };
