/**
 * Store Map task board — FAST WRITE proxy (speed step 5, Brigham 8/29).
 *
 * The client posts the same op payloads it sends the Apps Script bridge
 * (add/move/edit/note/snooze/reassign/archive/setcols). This function:
 *   1. writes Supabase immediately (sub-100ms authority; realtime pushes
 *      the change to every open board),
 *   2. returns at once,
 *   3. then forwards the identical op to the Apps Script bridge in the
 *      background — which keeps the Sheet mirror, the activity log, and
 *      the owner notifications (texts/emails) working with ZERO bridge
 *      changes.
 *
 * Activates only when SUPABASE_URL + SUPABASE_SERVICE_KEY are set; until
 * then it answers 503 and the client keeps using the bridge directly.
 */
const BRIDGE_URL =
  "https://script.google.com/macros/s/AKfycbxY4BKnr_Tr0iCTc9itCWhNYLvgszmkI1IoYSkbBWpyAqRtWI-yaUkJQjcVdgG58KXt/exec";
const ALLOW = ["https://blpstoremap.netlify.app", "http://localhost:8641"];

function cors(origin: string | null) {
  const o = origin && ALLOW.includes(origin) ? origin : ALLOW[0];
  return {
    "access-control-allow-origin": o,
    "access-control-allow-headers": "content-type",
    "content-type": "application/json",
  };
}

async function sb(path: string, method: string, body?: unknown) {
  const url = process.env.SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_KEY || "";
  const r = await fetch(url + "/rest/v1/" + path, {
    method,
    headers: {
      apikey: key,
      Authorization: "Bearer " + key,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!r.ok) throw new Error("supabase " + r.status + " " + (await r.text()).slice(0, 120));
}

export default async (req: Request, context: { waitUntil?: (p: Promise<unknown>) => void }) => {
  const headers = cors(req.headers.get("origin"));
  if (req.method === "OPTIONS") return new Response("", { headers });
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return new Response(JSON.stringify({ error: "supabase not configured yet" }), { status: 503, headers });
  }
  let p: Record<string, unknown>;
  try { p = await req.json(); } catch { return new Response(JSON.stringify({ error: "bad json" }), { status: 400, headers }); }
  if (p.key !== (process.env.BLP_APP_ACCESS_KEY || "") && p.pin !== (process.env.BLP_APP_ACCESS_KEY || "")) {
    return new Response(JSON.stringify({ error: "bad key" }), { status: 401, headers });
  }
  const op = String(p.op || "");
  const id = String(p.id || "");
  const nowIso = new Date().toISOString();
  try {
    let out: Record<string, unknown> = { ok: true };
    if (op === "add") {
      const newId = "tc" + Date.now().toString(36) + Math.floor(Math.random() * 1e4);
      await sb("tb_cards", "POST", {
        id: newId, owner: String(p.owner || ""), col: "todo",
        text: String(p.text || "").slice(0, 2000), serial: String(p.serial || ""),
        due: String(p.due || ""), from_who: String(p.from || ""),
        ord: Number(p.order) || 0, created: nowIso, updated_at: nowIso,
      });
      out = { ok: true, id: newId };
      p = { ...p, forceId: newId };   // bridge mirror uses its own id otherwise
    } else if (op === "move") {
      const patch: Record<string, unknown> = { col: String(p.col || ""), updated_at: nowIso };
      if (p.order !== undefined && isFinite(Number(p.order))) patch.ord = Number(p.order);
      if (p.col === "done") patch.done_at = nowIso;
      await sb("tb_cards?id=eq." + encodeURIComponent(id), "PATCH", patch);
    } else if (op === "edit") {
      const patch: Record<string, unknown> = { updated_at: nowIso };
      if (p.text !== undefined) patch.text = String(p.text).slice(0, 2000);
      if (p.due !== undefined) patch.due = String(p.due);
      if (p.serial !== undefined) patch.serial = String(p.serial);
      await sb("tb_cards?id=eq." + encodeURIComponent(id), "PATCH", patch);
    } else if (op === "snooze") {
      await sb("tb_cards?id=eq." + encodeURIComponent(id), "PATCH", { snooze: String(p.until || ""), updated_at: nowIso });
    } else if (op === "del" || op === "archive") {
      await sb("tb_cards?id=eq." + encodeURIComponent(id), "PATCH", { col: "archived", done_at: nowIso, updated_at: nowIso });
    } else if (op === "reassign") {
      await sb("tb_cards?id=eq." + encodeURIComponent(id), "PATCH", { owner: String(p.owner || ""), col: "todo", updated_at: nowIso });
    } else if (op === "note") {
      // notes concatenation needs the current value — bridge stays authoritative
      // for the mirrored copy; here we just append optimistically via RPC-less read
      const url = process.env.SUPABASE_URL + "/rest/v1/tb_cards?id=eq." + encodeURIComponent(id) + "&select=notes";
      const r = await fetch(url, { headers: { apikey: process.env.SUPABASE_SERVICE_KEY!, Authorization: "Bearer " + process.env.SUPABASE_SERVICE_KEY! } });
      const rows = (await r.json()) as Array<{ notes: string }>;
      const prev = rows[0]?.notes || "";
      const line = new Date().toLocaleDateString("en-US", { month: "numeric", day: "numeric", timeZone: "America/Denver" })
        + " " + String((p.user as { name?: string })?.name || "team").split(/\s+/)[0] + ": " + String(p.text || "").slice(0, 300);
      await sb("tb_cards?id=eq." + encodeURIComponent(id), "PATCH", { notes: (prev ? line + "\n" + prev : line).slice(0, 2000), updated_at: nowIso });
      out = { ok: true, line };
    } else if (op === "setcols") {
      await sb("tb_cols", "POST", { owner: String(p.owner || "").toLowerCase(), cols: p.cols || [] });
    } else {
      return new Response(JSON.stringify({ error: "bad op" }), { status: 400, headers });
    }
    // background: forward to the bridge → sheet mirror + notifications + log
    const mirror = fetch(BRIDGE_URL, {
      method: "POST",
      headers: { "content-type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ ...p, action: "taskcard" }),
    }).catch(() => {});
    if (context?.waitUntil) context.waitUntil(mirror);
    else await Promise.race([mirror, new Promise((res) => setTimeout(res, 50))]);
    return new Response(JSON.stringify(out), { headers });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error).message || e) }), { status: 502, headers });
  }
};
