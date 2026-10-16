/**
 * 📜→🧾 Contract sync (Brigham 9/4): every 30 minutes, apply any NEW Shopwork
 * Agreement form responses (Restoration Contracts tab) to the matching pianos'
 * Scope of Work. The bridge stamps each row, so a missed run is picked up by
 * the next. The work runs in contract-sync-background (Walter 10/16): this
 * function only hands it off, so Netlify never kills and retries it.
 */
import { kick } from "./lib/kick";
export default async (req: Request) => new Response(await kick(req, "contract-sync-background"));
export const config = { schedule: "20,50 * * * *" };
