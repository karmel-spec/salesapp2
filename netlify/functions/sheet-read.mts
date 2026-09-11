/**
 * Read-only, key-gated range reader for the cloud scheduling routine (Brigham
 * 9/11): cloud agents have no Google login, so they read the shop sheets here.
 *   GET ?key=…&id=<spreadsheetId>&range=<'Tab'!A1:Z200>  → {ok, values}
 * Only the allow-listed spreadsheets are readable; payment columns of the
 * Restoration Contracts tab are never served.
 */
import { sheetGet, KEY } from "./_blp-sched-lib.mts";
const ALLOW = new Set([
  "11RoeVRETag5rZYX6_tEH-rf6x8JL0JeZU0P5AT0WI-I",   // Friday-report / scheduling sheet
  "1ZunbPKygpQlcXfTyPowDHdUE9spJ3uV1XA4iX1eoKRc",   // Piano Log
  "1j1FP78rRj1jrl2z-_vIg95kN3GuG8TI4dpOheSnIoPc",   // BLP TEAM roster
  "1k9ToAeueEg5WOtaY91xXzL-a0l_AJsSZWw23tcAWECU",   // scheduling sheet (Sequence tab)
]);
export default async (req: Request) => {
  const u = new URL(req.url);
  const headers = { "content-type": "application/json", "cache-control": "no-store" };
  if ((u.searchParams.get("key") || "") !== KEY()) return new Response(JSON.stringify({ error: "bad key" }), { status: 401, headers });
  const id = u.searchParams.get("id") || "", range = u.searchParams.get("range") || "";
  if (!ALLOW.has(id)) return new Response(JSON.stringify({ error: "spreadsheet not allowed" }), { status: 403, headers });
  if (/restoration contracts/i.test(range)) return new Response(JSON.stringify({ error: "contracts tab is not served" }), { status: 403, headers });
  if (!range || range.length > 120) return new Response(JSON.stringify({ error: "range required" }), { status: 400, headers });
  try { const values = await sheetGet(id, range); return new Response(JSON.stringify({ ok: true, values }), { headers }); }
  catch (e) { return new Response(JSON.stringify({ error: String((e as Error).message || e) }), { status: 502, headers }); }
};
