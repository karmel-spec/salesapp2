// Scheduled: 7:50 AM standup text to the managers (a = one of the two UTC
// slots; the Denver wall-clock gate inside runStandupText picks the right one).
// Hands off to standup-text-background (Walter 10/16): a slow bridge used to
// get this function killed and RETRIED by Netlify — 10/1 and 10/15 sent twice.
import type { Config } from "@netlify/functions";
import { kick } from "./lib/kick";

export default async (req: Request) => new Response(await kick(req, "standup-text-background"));

export const config: Config = { schedule: "50 13 * * 1-5" };
