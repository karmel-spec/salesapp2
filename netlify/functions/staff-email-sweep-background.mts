/** Background worker (15-min budget): walk every mailbox in chunks so each
 *  console call stays short. POST ?key=…[&days=3] */
const SITE = process.env.URL || "https://blpsalesapp.netlify.app";
const KEY = process.env.BLP_APP_ACCESS_KEY || "";
const MAILBOXES = ["info@brighamlarsonpianos.com", "brigham@brighamlarsonpianos.com", "melissa@brighamlarsonpianos.com", "alisa@brighamlarsonpianos.com", "lisa@brighamlarsonpianos.com", "brighamlarson@gmail.com"];

export default async (req: Request) => {
  const url = new URL(req.url);
  if (url.searchParams.get("key") !== KEY) return new Response("unauthorized", { status: 403 });
  const days = Number(url.searchParams.get("days") || 3) || 3;
  const totals = { messages: 0, leadsTouched: 0, eventsAdded: 0, written: 0, errors: [] as string[] };
  for (const box of MAILBOXES) {
    let offset = 0;
    for (let guard = 0; guard < 40; guard++) {
      try {
        const r = await fetch(`${SITE}/api/sweep/staff-email?key=${encodeURIComponent(KEY)}&days=${days}&box=${encodeURIComponent(box)}&offset=${offset}&chunk=40`, { signal: AbortSignal.timeout(28_000) });
        const j = (await r.json().catch(() => ({}))) as { recentMessages?: number; leadsTouched?: number; eventsAdded?: number; written?: number; done?: boolean; nextOffset?: number | null; errors?: string[]; error?: string };
        if (!r.ok) { totals.errors.push(`${box}@${offset}: ${r.status} ${j.error || ""}`); break; }
        totals.messages += j.recentMessages || 0; totals.leadsTouched += j.leadsTouched || 0; totals.eventsAdded += j.eventsAdded || 0; totals.written += j.written || 0;
        if (j.errors?.length) totals.errors.push(...j.errors);
        if (j.done || j.nextOffset == null) break;
        offset = j.nextOffset;
      } catch (e) { totals.errors.push(`${box}@${offset}: ${String(e).slice(0, 80)}`); break; }
    }
  }
  console.log(`[staff-email-sweep] days=${days} messages ${totals.messages} leads ${totals.leadsTouched} events ${totals.eventsAdded} written ${totals.written}${totals.errors.length ? " errors: " + totals.errors.join(" | ") : ""}`);
  return new Response(JSON.stringify(totals), { status: 200, headers: { "content-type": "application/json" } });
};
