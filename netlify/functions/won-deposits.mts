/**
 * Queue-deposit answers from the WON shop handoffs, for the Shop Manager
 * brief's Delivery Forecasting (Walter 10/15): a piano arriving in the next 14
 * days is "ready to work on" when its $1,000 queue deposit is in.
 *
 *   GET ?key=<app key>  → {ok, handoffs:[{lead_name, serial, piano, deposit, payment, created_at}]}
 *
 * deposit = the handoff's "$1,000 queue deposit" answer: collected | admin | nd
 * (Assign to Admin / Not discussed). It is the answer at close — the Piano Log
 * card's Pre-Queue / Queue Approved status is the live record and wins in the
 * brief; this fills in pianos that have no card yet.
 */
const KEY = () => process.env.BLP_APP_ACCESS_KEY || "pianoman";

export default async (req: Request) => {
  const u = new URL(req.url);
  if ((u.searchParams.get("key") || "") !== KEY()) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
  const SB = (process.env.SUPABASE_URL || "").replace(/\/$/, ""), SK = process.env.SUPABASE_SERVICE_KEY || "";
  if (!SB || !SK) return new Response(JSON.stringify({ ok: false, error: "supabase env not set", handoffs: [] }), { status: 503 });
  const since = new Date(Date.now() - 180 * 86400000).toISOString();
  const r = await fetch(`${SB}/rest/v1/won_handoffs?status=eq.sent&branch=eq.shop&created_at=gte.${encodeURIComponent(since)}`
    + `&select=lead_name,serial,piano,answers,created_at&order=created_at.desc&limit=300`,
    { headers: { apikey: SK, Authorization: "Bearer " + SK } });
  if (!r.ok) return new Response(JSON.stringify({ ok: false, error: "won_handoffs " + r.status, handoffs: [] }), { status: 502 });
  const rows = (await r.json()) as Array<{ lead_name: string; serial: string | null; piano: string | null; created_at: string; answers: any }>;
  // answers.items.<id>.v — the same field the handoff email's shop scheduling gate reads (Karmel 10/13)
  const pick = (a: any, k: string) => { const v = a && a.items && a.items[k]; return String((v && typeof v === "object" ? v.v : v) || ""); };
  const handoffs = rows.map(x => ({
    lead_name: x.lead_name, serial: x.serial || "", piano: x.piano || "", created_at: x.created_at,
    deposit: pick(x.answers, "deposit"), payment: pick(x.answers, "payment"),
  }));
  return new Response(JSON.stringify({ ok: true, handoffs }), { headers: { "content-type": "application/json" } });
};
