/**
 * Quiet-hours SMS drain (Brigham 9/3): texts to team members composed
 * outside 10am-4pm Denver wait in bridge_queue (status "sms-queued",
 * payload {name, message}). Every 10 minutes this checks the Denver
 * clock and, once inside the window, delivers them through
 * request-notify (which does the Tech Phones lookup + Twilio send).
 */
export default async () => {
  const hr = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver",
    hour12: false, hour: "2-digit" }).format(new Date()));
  if (hr < 10 || hr >= 16) return new Response("outside window");
  const SB = process.env.SUPABASE_URL || "";
  const KEY = process.env.SUPABASE_SERVICE_KEY || "";
  if (!SB || !KEY) return new Response("no supabase env", { status: 503 });
  const H = { apikey: KEY, Authorization: "Bearer " + KEY, "Content-Type": "application/json" };
  const rows = (await (await fetch(
    `${SB}/rest/v1/bridge_queue?status=eq.sms-queued&order=created.asc&limit=20`,
    { headers: H })).json()) as Array<{ id: number; attempts: number; payload: { name: string; message: string } }>;
  let sent = 0;
  for (const row of rows) {
    let ok = false, err = "";
    try {
      const r = await fetch("https://blpsalesapp.netlify.app/.netlify/functions/request-notify", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ key: process.env.BLP_APP_ACCESS_KEY || "pianoman",
          name: row.payload.name, message: row.payload.message, now: true }) });
      const j = (await r.json()) as { sent?: boolean; reason?: string; error?: string };
      ok = !!j.sent; err = j.reason || j.error || "";
    } catch (e) { err = String((e as Error).message || e).slice(0, 150); }
    const attempts = (row.attempts || 0) + 1;
    await fetch(`${SB}/rest/v1/bridge_queue?id=eq.${row.id}`, {
      method: "PATCH", headers: H,
      body: JSON.stringify(ok
        ? { status: "sms-sent", attempts, updated: new Date().toISOString() }
        : { status: attempts >= 10 ? "sms-dead" : "sms-queued", attempts,
            last_error: err, updated: new Date().toISOString() }) });
    if (ok) sent++;
  }
  return new Response(JSON.stringify({ checked: rows.length, sent }));
};
export const config = { schedule: "*/10 * * * *" };
