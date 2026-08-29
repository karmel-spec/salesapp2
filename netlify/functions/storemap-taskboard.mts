/**
 * Store Map task board — FAST READ path (speed step 4, Brigham 8/29).
 * Serves the same {rows, cols} shape as the Apps Script bridge's
 * fn=taskboard, but straight from the Sheets API via the sales console's
 * service account: ~300-600ms instead of the bridge's 3-6s. Writes still
 * go through the bridge (notifications + activity log live there).
 *
 *   GET ?key=…  → {ok, rows:[{id,owner,col,text,serial,due,from,created,
 *                              done,order,notes,snooze}], cols:{owner:…},
 *                  fetchedAt}
 *
 * Auth: `key` = BLP_APP_ACCESS_KEY (same team key the app already uses).
 * CORS: Store Map origins only.
 */
import * as crypto from "node:crypto";

const SHEET_ID = "11RoeVRETag5rZYX6_tEH-rf6x8JL0JeZU0P5AT0WI-I";
const ALLOW = [
  "https://blpstoremap.netlify.app",
  "http://localhost:8641",
];

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

function cors(origin: string | null) {
  const o = origin && ALLOW.includes(origin) ? origin : ALLOW[0];
  return {
    "access-control-allow-origin": o,
    "access-control-allow-headers": "content-type",
    "content-type": "application/json",
    "cache-control": "no-store",
  };
}

export default async (req: Request) => {
  const headers = cors(req.headers.get("origin"));
  if (req.method === "OPTIONS") return new Response("", { headers });
  const url = new URL(req.url);
  if ((url.searchParams.get("key") || "") !== (process.env.BLP_APP_ACCESS_KEY || "")) {
    return new Response(JSON.stringify({ error: "bad key" }), { status: 401, headers });
  }
  try {
    const token = await googleToken();
    const ranges = ["Task Boards!A2:L5000", "Board Columns!A2:B200"];
    const r = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values:batchGet?` +
        ranges.map((x) => "ranges=" + encodeURIComponent(x)).join("&"),
      { headers: { Authorization: "Bearer " + token } },
    );
    if (!r.ok) throw new Error("sheets " + r.status);
    const data = (await r.json()) as { valueRanges: Array<{ values?: string[][] }> };
    const tb = data.valueRanges[0]?.values || [];
    const bc = data.valueRanges[1]?.values || [];
    const rows = tb
      .filter((v) => v[0] && v[3])
      .map((v) => ({
        id: String(v[0]),
        owner: String(v[1] || ""),
        col: String(v[2] || "todo"),
        text: String(v[3]).slice(0, 2000),
        serial: String(v[4] || ""),
        due: String(v[5] || ""),
        from: String(v[6] || ""),
        created: String(v[7] || ""),
        done: String(v[8] || ""),
        order: v[9] === "" || v[9] == null ? null : Number(v[9]),
        notes: String(v[10] || "").slice(0, 2000),
        snooze: String(v[11] || ""),
      }));
    const cols: Record<string, unknown> = {};
    for (const v of bc) {
      if (!v[0]) continue;
      try { cols[String(v[0]).toLowerCase()] = JSON.parse(String(v[1] || "[]")); } catch { /* skip bad json */ }
    }
    return new Response(JSON.stringify({ ok: true, rows, cols, fetchedAt: new Date().toISOString() }), { headers });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error).message || e) }), { status: 502, headers });
  }
};
