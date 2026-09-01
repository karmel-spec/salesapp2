/**
 * Store Map task board — SHEET → SUPABASE reconciler (Brigham 9/1).
 *
 * Heals the split-brain: when a client's write falls back to the Apps
 * Script bridge (proxy blip, or a stale cached app version), the card
 * lands on the SHEET only — invisible to Supabase-first reads. This
 * function copies sheet-only cards (and column configs for owners
 * missing in Supabase) into Supabase. Supabase stays the authority for
 * every id it already has — nothing existing is overwritten.
 *
 * GET ?key=…  → {ok, addedCards, addedCols, checked}
 * Runs on demand and from taskboard-reconcile-cron every 10 minutes.
 */
import * as crypto from "node:crypto";

const SHEET_ID = "11RoeVRETag5rZYX6_tEH-rf6x8JL0JeZU0P5AT0WI-I";

let tokenCache: { token: string; exp: number } | null = null;
async function googleToken(): Promise<string> {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || "";
  const key = (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
  if (!email || !key) throw new Error("Google service account env not set");
  const now = Math.floor(Date.now() / 1000);
  if (tokenCache && tokenCache.exp > now + 60) return tokenCache.token;
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const header = b64({ alg: "RS256", typ: "JWT" });
  const claims = b64({
    iss: email,
    scope: "https://www.googleapis.com/auth/spreadsheets.readonly",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  });
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  const signature = signer.sign(key).toString("base64url");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${header}.${claims}.${signature}`,
    }),
  });
  if (!res.ok) throw new Error(`Google token exchange failed (${res.status})`);
  const j = (await res.json()) as { access_token: string; expires_in: number };
  tokenCache = { token: j.access_token, exp: now + j.expires_in };
  return j.access_token;
}

function sbHeaders() {
  const key = process.env.SUPABASE_SERVICE_KEY || "";
  return { apikey: key, Authorization: "Bearer " + key, "Content-Type": "application/json" };
}

export default async (req: Request) => {
  const url = new URL(req.url);
  if ((url.searchParams.get("key") || "") !== (process.env.BLP_APP_ACCESS_KEY || "")) {
    return new Response(JSON.stringify({ error: "bad key" }), { status: 401 });
  }
  const SB = process.env.SUPABASE_URL || "";
  if (!SB || !process.env.SUPABASE_SERVICE_KEY) {
    return new Response(JSON.stringify({ error: "supabase env not set" }), { status: 503 });
  }
  try {
    // 1. sheet state
    const token = await googleToken();
    const ranges = ["Task Boards!A2:L5000", "Board Columns!A2:B200"];
    const r = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values:batchGet?` +
        ranges.map((x) => "ranges=" + encodeURIComponent(x)).join("&"),
      { headers: { Authorization: "Bearer " + token } },
    );
    if (!r.ok) throw new Error("sheets " + r.status);
    const data = (await r.json()) as { valueRanges: Array<{ values?: string[][] }> };
    const tb = (data.valueRanges[0]?.values || []).filter((v) => v[0] && v[3]);
    const bc = (data.valueRanges[1]?.values || []).filter((v) => v[0]);

    // 2. supabase state (ids + col owners only)
    const [cr, kr] = await Promise.all([
      fetch(SB + "/rest/v1/tb_cards?select=id", { headers: sbHeaders() }),
      fetch(SB + "/rest/v1/tb_cols?select=owner", { headers: sbHeaders() }),
    ]);
    const haveIds = new Set(((await cr.json()) as Array<{ id: string }>).map((x) => x.id));
    const haveOwners = new Set(((await kr.json()) as Array<{ owner: string }>).map((x) => x.owner.toLowerCase()));

    // 3. sheet-only cards → insert (Supabase wins for ids it already has)
    const iso = (v: string) => {
      const d = new Date(v);
      return isNaN(d.getTime()) ? null : d.toISOString();
    };
    const missing = tb
      .filter((v) => !haveIds.has(String(v[0])))
      .map((v) => ({
        id: String(v[0]), owner: String(v[1] || ""), col: String(v[2] || "todo"),
        text: String(v[3]).slice(0, 2000), serial: String(v[4] || ""), due: String(v[5] || ""),
        from_who: String(v[6] || ""), created: iso(String(v[7] || "")), done_at: iso(String(v[8] || "")),
        ord: v[9] === "" || v[9] == null ? null : Number(v[9]),
        notes: String(v[10] || "").slice(0, 2000), snooze: String(v[11] || ""),
        updated_at: new Date().toISOString(),
      }));
    if (missing.length) {
      const ins = await fetch(SB + "/rest/v1/tb_cards?on_conflict=id", {
        method: "POST",
        headers: { ...sbHeaders(), Prefer: "resolution=ignore-duplicates,return=minimal" },
        body: JSON.stringify(missing),
      });
      if (!ins.ok) throw new Error("card insert " + ins.status + " " + (await ins.text()).slice(0, 120));
    }

    // 4. column configs for owners Supabase doesn't know yet
    const newCols = bc
      .filter((v) => !haveOwners.has(String(v[0]).toLowerCase()))
      .map((v) => {
        try { return { owner: String(v[0]).toLowerCase(), cols: JSON.parse(String(v[1] || "[]")) }; }
        catch { return null; }
      })
      .filter(Boolean);
    if (newCols.length) {
      const ins2 = await fetch(SB + "/rest/v1/tb_cols?on_conflict=owner", {
        method: "POST",
        headers: { ...sbHeaders(), Prefer: "resolution=ignore-duplicates,return=minimal" },
        body: JSON.stringify(newCols),
      });
      if (!ins2.ok) throw new Error("cols insert " + ins2.status + " " + (await ins2.text()).slice(0, 120));
    }
    return new Response(JSON.stringify({
      ok: true, checked: tb.length, addedCards: missing.length,
      addedCols: newCols.map((c) => (c as { owner: string }).owner),
    }), { headers: { "content-type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error).message || e) }), { status: 502 });
  }
};
