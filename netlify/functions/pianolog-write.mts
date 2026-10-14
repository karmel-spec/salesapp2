/**
 * Store Map — DURABLE PIANO LOG WRITE RELAY (speed/reliability step 6,
 * Brigham 9/3: "ENSURE every change is SAVED").
 *
 * The client sends the exact payload it would send the Apps Script
 * bridge (setphase / move / set* — idempotent ops only). This function:
 *   1. records the op in Supabase `bridge_queue` (durable, instant),
 *   2. tries the bridge inline with a short budget — a REAL bridge
 *      result marks the row done and is returned verbatim,
 *   3. if Google misroutes (generic ping), times out, or errors, the op
 *      stays queued and the client gets {ok:true, queued:true, qid} — and a
 *      background drain is kicked AT ONCE (10/14), so the row normally lands
 *      within ~15–30 s instead of at the next 5-minute cron (measured Oct
 *      9–13: 0 of 40 writes confirmed inline, every one landed 2–4 min later
 *      while the card said "the bridge is slow"). The worker keeps retrying
 *      until the bridge confirms; GET ?qid= reports where a write stands.
 *
 * Only resend-safe ops belong here: everything whitelisted sets absolute
 * values, so a retry after an ambiguous timeout cannot double-apply.
 */
import { patchMirror, triggerSync } from "./lib/pianolog-mirror.mts";
import { directWrite } from "./lib/pianolog-direct.mts";

const BRIDGE_URL =
  "https://script.google.com/macros/s/AKfycbxY4BKnr_Tr0iCTc9itCWhNYLvgszmkI1IoYSkbBWpyAqRtWI-yaUkJQjcVdgG58KXt/exec";
const SITE = "https://blpsalesapp.netlify.app";
const ALLOW = ["https://blpstoremap.netlify.app", "http://localhost:8641"];
const RELAY_OK = /^(set[a-z]+|move|unmarkduplicate|tempresolve)$/;

function cors(origin: string | null) {
  const o = origin && ALLOW.includes(origin) ? origin : ALLOW[0];
  return {
    "access-control-allow-origin": o,
    "access-control-allow-headers": "content-type",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "content-type": "application/json",
  };
}
function sbHeaders() {
  const key = process.env.SUPABASE_SERVICE_KEY || "";
  return { apikey: key, Authorization: "Bearer " + key, "Content-Type": "application/json" };
}

// a bridge response only counts when it's JSON and NOT the generic ping
export function realBridgeResult(j: unknown): boolean {
  return !!j && typeof j === "object" && !("service" in (j as object));
}

export async function forwardToBridge(payload: unknown, budgetMs: number): Promise<{ kind: "real" | "ping" | "fail"; body?: unknown; err?: string }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), budgetMs);
  try {
    const r = await fetch(BRIDGE_URL, {
      method: "POST",
      redirect: "follow",
      headers: { "content-type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    const txt = await r.text();
    let j: unknown;
    try { j = JSON.parse(txt); } catch { return { kind: "fail", err: "non-JSON " + txt.slice(0, 60) }; }
    return realBridgeResult(j) ? { kind: "real", body: j } : { kind: "ping" };
  } catch (e) {
    return { kind: "fail", err: String((e as Error).message || e).slice(0, 120) };
  } finally {
    clearTimeout(t);
  }
}

/** Start the background queue drain now (10/14): returns once Netlify has
 *  accepted the job (202, ~0.2 s). The 5-minute cron stays as the safety net. */
export async function kickDrain(reason: string): Promise<boolean> {
  try {
    const qs = new URLSearchParams({ key: process.env.BLP_APP_ACCESS_KEY || "", reason });
    const r = await fetch(`${SITE}/.netlify/functions/bridge-queue-worker-background?${qs}`, { method: "POST", signal: AbortSignal.timeout(2500) });
    return r.status === 202 || r.ok;
  } catch (e) {
    console.warn("queue drain kick failed:", String((e as Error).message || e).slice(0, 120));
    return false;
  }
}

/* Did a Delivered change land anyway? (Walter 10/13) The bridge often finishes
 * moving the row after the relay stopped waiting, and the card then told Mark
 * the Bechstein 21174 Delivered "did not confirm" when it had. Reads the Piano
 * Log through the service account: landed = a row with this serial BELOW the
 * SOLD divider whose CURRENT PHASE is Delivered. null = couldn't tell. */
const PIANO_LOG_ID = "1ZunbPKygpQlcXfTyPowDHdUE9spJ3uV1XA4iX1eoKRc";
let saTok: { token: string; exp: number } | null = null;
async function saToken(): Promise<string> {
  const crypto = await import("node:crypto");
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || "";
  const key = (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
  if (!email || !key) throw new Error("service account env not set");
  const now = Math.floor(Date.now() / 1000);
  if (saTok && saTok.exp > now + 60) return saTok.token;
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const head = b64({ alg: "RS256", typ: "JWT" });
  const claims = b64({ iss: email, scope: "https://www.googleapis.com/auth/spreadsheets.readonly",
    aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 });
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(`${head}.${claims}`);
  const sig = signer.sign(key).toString("base64url");
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${head}.${claims}.${sig}` }) });
  if (!r.ok) throw new Error("token " + r.status);
  const j = (await r.json()) as { access_token: string; expires_in: number };
  saTok = { token: j.access_token, exp: now + j.expires_in };
  return j.access_token;
}
const colA1 = (n: number) => { let x = ""; while (n > 0) { const m = (n - 1) % 26; x = String.fromCharCode(65 + m) + x; n = Math.floor((n - 1) / 26); } return x; };
export async function deliveredLanded(serial: string): Promise<boolean | null> {
  try {
    const t = await saToken();
    const get = async (ranges: string[]) => {
      const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${PIANO_LOG_ID}/values:batchGet?` +
        ranges.map(x => "ranges=" + encodeURIComponent(x)).join("&"), { headers: { Authorization: "Bearer " + t } });
      if (!r.ok) throw new Error("sheets " + r.status);
      return ((await r.json()) as { valueRanges: Array<{ values?: string[][] }> }).valueRanges.map(v => v.values || []);
    };
    const [hdr, bc] = await get(["'Piano Log'!A2:ZZ2", "'Piano Log'!B1:C6000"]);
    const pIdx = (hdr[0] || []).findIndex(h => String(h).trim().toUpperCase() === "CURRENT PHASE");
    if (pIdx < 0) return null;
    const [ph] = await get([`'Piano Log'!${colA1(pIdx + 1)}1:${colA1(pIdx + 1)}6000`]);
    const want = serial.trim().toLowerCase();
    let sold = 0;
    for (let i = 0; i < bc.length; i++) {
      if (String(bc[i]?.[0] || "").trim().toUpperCase() === "SOLD" && !String(bc[i]?.[1] || "").trim()) { sold = i + 1; break; }
    }
    if (!sold) return null;
    for (let i = sold; i < bc.length; i++) {
      if (String(bc[i]?.[1] || "").trim().toLowerCase() === want
          && /^delivered$/i.test(String(ph[i]?.[0] || "").trim())) return true;
    }
    return false;
  } catch { return null; }
}

export default async (req: Request) => {
  const headers = cors(req.headers.get("origin"));
  if (req.method === "OPTIONS") return new Response("", { headers });
  // GET ?qid=&key= — where a queued write stands, so the app can follow up a
  // "⏳ Saved" with ✓ landed or ✗ failed (Hunter 10/9, 100926rawlings10)
  if (req.method === "GET") {
    const u = new URL(req.url);
    if ((u.searchParams.get("key") || "") !== (process.env.BLP_APP_ACCESS_KEY || "")) {
      return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers });
    }
    const qid = Number(u.searchParams.get("qid") || 0);
    if (!qid || !process.env.SUPABASE_URL) return new Response(JSON.stringify({ error: "qid required" }), { status: 400, headers });
    const r = await fetch(`${process.env.SUPABASE_URL}/rest/v1/bridge_queue?id=eq.${qid}&select=status,last_error,result,attempts`, { headers: sbHeaders() });
    const row = r.ok ? ((await r.json()) as Array<Record<string, unknown>>)[0] : null;
    if (!row) return new Response(JSON.stringify({ error: "not found" }), { status: 404, headers });
    const res = (row.result || {}) as Record<string, unknown>;
    return new Response(JSON.stringify({ ok: true, status: row.status, error: row.status === "failed" ? (row.last_error || res.error || "failed") : null,
      location: res.location ?? null, stale: !!res.stale, noop: !!res.noop }), { headers });
  }
  const SB = process.env.SUPABASE_URL || "";
  if (!SB || !process.env.SUPABASE_SERVICE_KEY) {
    return new Response(JSON.stringify({ error: "relay not configured" }), { status: 503, headers });
  }
  let p: Record<string, unknown>;
  try { p = await req.json(); } catch { return new Response(JSON.stringify({ error: "bad json" }), { status: 400, headers }); }
  if (p.relayKey !== (process.env.BLP_APP_ACCESS_KEY || "")) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers });
  }
  const action = String(p.action || "");
  if (!RELAY_OK.test(action)) {
    return new Response(JSON.stringify({ error: "action not relayable: " + action }), { status: 400, headers });
  }
  const { relayKey: _drop, ...payload } = p;
  // setphase → Delivered is NEVER replayed from the queue (Walter 10/2): on
  // 9/28 an inline attempt that had in fact landed was marked ambiguous, the
  // piano was put back by hand, and 15 minutes later the worker re-applied
  // the queued copy — Steinway D #38930 went off the map again unnoticed for
  // four days. Delivered is a one-way move off the map, so it is inline-only:
  // if the bridge's answer is not a real result the client is told to try
  // again instead of a robot finishing the job later.
  const humanOnly = action === "setphase" && /^delivered$/i.test(String((payload as { phase?: unknown }).phase || ""));

  // 1. durable record first — the op can no longer be lost
  const ins = await fetch(SB + "/rest/v1/bridge_queue", {
    method: "POST",
    headers: { ...sbHeaders(), Prefer: "return=representation" },
    body: JSON.stringify({ action, payload }),
  });
  if (!ins.ok) {
    return new Response(JSON.stringify({ error: "queue write failed " + ins.status }), { status: 502, headers });
  }
  const qid = ((await ins.json()) as Array<{ id: number }>)[0]?.id;

  // 2a. DIRECT (step 2, 10/14): the plain cell-setting writes go straight to
  //     the sheet through the Sheets API in ~1 s — same cells, same activity
  //     log line, same result shape as the bridge (lib/pianolog-direct.mts).
  //     null = this one is the bridge's (Delivered, Exit Prep, a missing
  //     column, an unverifiable caller); a thrown Sheets error = bridge too.
  if (!humanOnly) {
    let d: Record<string, unknown> | null = null;
    try { d = await directWrite(action, payload); }
    catch (e) { console.warn("pianolog-direct failed, using the bridge:", action, String((e as Error).message || e).slice(0, 160)); }
    if (d) {
      const failed = !!d.error;
      await fetch(`${SB}/rest/v1/bridge_queue?id=eq.${qid}`, {
        method: "PATCH", headers: sbHeaders(),
        body: JSON.stringify({ status: failed ? "failed" : "done", result: d, attempts: 1,
          last_error: failed ? String(d.error).slice(0, 200) : "direct", updated: new Date().toISOString() }),
      }).catch(() => {});
      if (!failed) {
        await patchMirror(action, payload, d);
        await triggerSync("write");
      }
      return new Response(JSON.stringify(d), { headers });
    }
  }

  // 2b. inline attempt at the bridge — when Google behaves the caller gets
  //     the bridge's true result (bumped lists, done flags, …)
  // Delivered gets a longer wait (Walter 10/13): it moves a whole row, and it is
  // never retried later, so the inline answer is the only answer
  const fw = await forwardToBridge(payload, humanOnly ? 16000 : 8000);   // + up to ~7 s of checking, inside the ~26 s limit
  if (fw.kind === "real") {
    await fetch(`${SB}/rest/v1/bridge_queue?id=eq.${qid}`, {
      method: "PATCH", headers: sbHeaders(),
      body: JSON.stringify({ status: "done", result: fw.body, attempts: 1, updated: new Date().toISOString() }),
    }).catch(() => {});
    // read mirror (10/7): patch the Supabase copy with the bridge's real
    // result so both apps show the change now, then kick a full sync
    const body = (fw.body || {}) as Record<string, unknown>;
    if (!body.error) {
      await patchMirror(action, payload, body);
      await triggerSync("write");
    }
    return new Response(JSON.stringify(fw.body), { headers });
  }
  if (humanOnly) {
    // before saying it failed, look: the bridge may have finished after we
    // stopped waiting. Two looks, 3 s apart, inside the function's time limit.
    const serial = String((payload as { serial?: unknown }).serial || "");
    let landed: boolean | null = serial ? await deliveredLanded(serial) : null;
    if (landed === false && serial) { await new Promise(r => setTimeout(r, 3000)); landed = await deliveredLanded(serial); }
    if (landed) {
      await fetch(`${SB}/rest/v1/bridge_queue?id=eq.${qid}`, {
        method: "PATCH", headers: sbHeaders(),
        body: JSON.stringify({ status: "done", attempts: 1, last_error: "confirmed from the Piano Log after a slow bridge answer", updated: new Date().toISOString() }),
      }).catch(() => {});
      return new Response(JSON.stringify({ ok: true, phase: "Delivered", movedToSold: true, verified: true,
        note: "confirmed from the Piano Log" }), { headers });
    }
    await fetch(`${SB}/rest/v1/bridge_queue?id=eq.${qid}`, {
      method: "PATCH", headers: sbHeaders(),
      body: JSON.stringify({ status: "failed", attempts: 1, last_error: "not queued: Delivered is inline-only (" + (fw.err || fw.kind) + ")", updated: new Date().toISOString() }),
    }).catch(() => {});
    return new Response(JSON.stringify({ error: "the bridge did not confirm the Delivered change — check the card and try again (Delivered is never applied later by the queue)" }), { status: 502, headers });
  }
  await fetch(`${SB}/rest/v1/bridge_queue?id=eq.${qid}`, {
    method: "PATCH", headers: sbHeaders(),
    body: JSON.stringify({ attempts: 1, last_error: fw.err || fw.kind, updated: new Date().toISOString() }),
  }).catch(() => {});
  // 3. still queued — honest ack: saved durably, applying shortly. The read
  //    mirror gets the absolute value now (the queue will land the same
  //    value); the sync re-applies it on top of the sheet row until the queued
  //    write is done. The drain starts NOW, not at the next cron (10/14).
  await patchMirror(action, payload);
  await kickDrain("write");
  return new Response(JSON.stringify({ ok: true, queued: true, qid }), { headers });
};
