/**
 * Fire-and-forget twin of request-notify: Netlify answers 202 the instant the
 * request arrives and runs the same send in the background. The Apps Script
 * bridge uses this for texts it sends INSIDE a user action (clock-fix request
 * → Mark/Melissa), so the person's "Request sent" no longer waits on the
 * Google token + phone sheet + quiet-hours lookup + Twilio round trip
 * (Avery 10/9, request 100926moore07). Same body, same key.
 */
import handler from "./request-notify.mts";

export default async (req: Request) => {
  try { await handler(req); } catch (e) { console.error("request-notify-background", (e as Error).message); }
};
