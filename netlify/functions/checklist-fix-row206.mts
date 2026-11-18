/**
 * ONE-TIME (Mark 11/18): upright Cabinetry Cleaning and Prep step 5 (Phase
 * Checklists row 206) had its instruction cut off mid-sentence ("…not to get
 * any oil based…"). Short instruction in E, the caution in F — the way the
 * grand steps read. The handbook text (G) is untouched. Guarded; removed from
 * the repo after it has run.   POST {key, dry?:true}
 */
import { googleToken, REPORT_SHEET, KEY } from "./_blp-sched-lib.mts";

const TAB = "Phase Checklists";
const TEXT = "Clean as much as you can without removing screws";
const CAUTION = "No oil-based cleaner near the tuning pins — it can get into the pinblock. No liquid cleaning products on the bass strings.";

export default async (req: Request) => {
  const headers = { "content-type": "application/json", "cache-control": "no-store" };
  const out = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers });
  if (req.method !== "POST") return out({ error: "POST" }, 405);
  let b: Record<string, unknown> = {};
  try { b = JSON.parse(await req.text()); } catch { return out({ error: "bad json" }, 400); }
  if (String(b.key || "") !== KEY()) return out({ error: "unauthorized" }, 401);
  try {
    const tok = await googleToken();
    const api = `https://sheets.googleapis.com/v4/spreadsheets/${REPORT_SHEET}`;
    const auth = { Authorization: "Bearer " + tok, "Content-Type": "application/json" };
    const r = await fetch(`${api}/values/${encodeURIComponent(`'${TAB}'!A206:J206`)}`, { headers: auth });
    if (!r.ok) return out({ error: "read " + r.status }, 502);
    const row = (((await r.json()) as { values?: string[][] }).values || [[]])[0] || [];
    const c = (i: number) => String(row[i] || "").trim();
    const problems: string[] = [];
    if (c(0) !== "Cabinetry Cleaning and Prep" || c(2).toLowerCase() !== "upright") problems.push("row 206 is not the upright cleaning step");
    if (c(4).indexOf("Clean as much as you can without removing screws") !== 0) problems.push("row 206 step is: " + c(4).slice(0, 50));
    if (c(5)) problems.push("row 206 already has a caution: " + c(5).slice(0, 50));
    if (problems.length || b.dry) return out({ ok: !problems.length, dry: true, problems, was: c(4) });
    const w = await fetch(`${api}/values:batchUpdate`, { method: "POST", headers: auth, body: JSON.stringify({ valueInputOption: "RAW",
      data: [{ range: `'${TAB}'!E206:F206`, values: [[TEXT, CAUTION]] }] }) });
    return out({ ok: w.ok, error: w.ok ? undefined : (await w.text()).slice(0, 200) }, w.ok ? 200 : 502);
  } catch (e) {
    return out({ error: String((e as Error).message || e).slice(0, 200) }, 500);
  }
};

export const config = { path: "/.netlify/functions/checklist-fix-row206" };
