/**
 * ONE-TIME (Mark 11/18): the upright Regulation steps' caution lines (Phase
 * Checklists rows 224–231, column F) were ~240-character cuts of the handbook
 * ending in "…". Each becomes a sentence or two of the key points, the way
 * the grand regulation steps read; the handbook text (G) is untouched.
 * Guarded; removed from the repo after it has run.   POST {key, dry?:true}
 */
import { googleToken, REPORT_SHEET, KEY } from "./_blp-sched-lib.mts";

const TAB = "Phase Checklists";
const ITEMS: Array<[number, string, string, string]> = [
 [
  224,
  "Square, space and level keys",
  "Install keyslip.",
  "Keyslip on. Keys 1 and 88 at the same height, 23/32\"–27/32\" above the keyslip (.718\"–.841\"); favor what the piano has. Level the whites to a straight edge between them, then the sharps."
 ],
 [
  225,
  "Choosing rest rail height",
  "Set dip on 3 samples only",
  "Three samples only: C2, C4 and C6. Let-off 1/8\" on the samples, then check for about .025\"–.050\" of aftertouch. If there isn't enough, add thicker cloth under a rest rail support until there is."
 ],
 [
  226,
  "Regulate all lost motion",
  "Jack barely touches",
  "Jack barely touches the hammer butt, with no pressure on it. The shank rests on the rest rail, not the jack. Tug the rest rail back gently to find capstans that are too high."
 ],
 [
  227,
  "Regulate let off",
  "Ensure all let off rail screws",
  "Let-off rail screws very tight, jack toes centered on the buttons. 1/8\" magnetic strip on the strings at the strike point: the hammer barely kisses it before it pulls back."
 ],
 [
  228,
  "Align backchecks",
  "Only bend backcheck wires",
  "Bend backcheck wires only at the very top and very bottom. Backcheck and catcher meet dead center, holding at ½–¾ blow distance on a mezzo-forte blow. Sight down the line and fix the worst first."
 ],
 [
  229,
  "Regulate Dip",
  "Regulate key dip on all whites",
  "By aftertouch, whites first, then sharps: at .025\" the jack still barely slips out from under the butt; at .050\" it doesn't."
 ],
 [
  230,
  "Damper lift regulation",
  "Bend damper wires only",
  "Bend damper wires only at the very top and very bottom. Early dampers forward, late dampers back, at the bottom of the wire, until they all lift together. Often already good on pianos under about 60 years old — check it."
 ],
 [
  231,
  "Damper spoon regulation",
  "Keep action in the piano",
  "Action stays in the piano. Bend spoons so the damper starts to lift when the hammer is 40–60% of the way to the string. Often already good on pianos under about 60 years old — check it."
 ]
];

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
    const r = await fetch(`${api}/values/${encodeURIComponent(`'${TAB}'!A224:J231`)}`, { headers: auth });
    if (!r.ok) return out({ error: "read " + r.status }, 502);
    const v = ((await r.json()) as { values?: string[][] }).values || [];
    const cell = (row: number, col: number) => String((v[row - 224] || [])[col] || "").trim();
    const problems: string[] = [];
    for (const [row, step, was] of ITEMS) {
      if (cell(row, 0) !== "Regulation" || cell(row, 2).toLowerCase() !== "upright") problems.push("row " + row + " is not an upright Regulation step");
      if (cell(row, 4).indexOf(step) !== 0) problems.push("row " + row + " step is " + cell(row, 4).slice(0, 40));
      if (cell(row, 5).indexOf(was) !== 0) problems.push("row " + row + " caution changed: " + cell(row, 5).slice(0, 40));
    }
    if (problems.length || b.dry) return out({ ok: !problems.length, dry: true, problems, count: ITEMS.length });
    const data = ITEMS.map(([row, , , text]) => ({ range: `'${TAB}'!F${row}`, values: [[text]] }));
    const w = await fetch(`${api}/values:batchUpdate`, { method: "POST", headers: auth, body: JSON.stringify({ valueInputOption: "RAW", data }) });
    return out({ ok: w.ok, wrote: w.ok ? ITEMS.length : 0, error: w.ok ? undefined : (await w.text()).slice(0, 200) }, w.ok ? 200 : 502);
  } catch (e) {
    return out({ error: String((e as Error).message || e).slice(0, 200) }, 500);
  }
};

export const config = { path: "/.netlify/functions/checklist-fix-upright-reg" };
