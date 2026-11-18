/**
 * ONE-TIME seed (Mark 11/18; refurbish plan approved by Brigham 11/17): grand
 * refurbishes run the same four phases as uprights.
 *   · Cabinetry Cleaning and Prep — 19 GRAND steps: before pics, handbook
 *     section 10 "Grand Cleaning - Refurb level" (12), then the general steps
 *     section 10 leaves out (pedals, trapwork, keybed, keys, bushings, key cleaning)
 *   · Action Problems and Hammer Prep + Action Lubrication and Alignment — the
 *     upright rows 207–223 become variant "all" (same steps + mini-QC lines),
 *     except row 217 "Blow out action outside", which stays upright-only
 *     (a grand's action is blown out in phase 1)
 *   · Regulation — 22 GRAND steps from handbook section 9 (the three it repeats
 *     from phases 2–3 left out); the upright rows 224–231 stay upright-only
 * New rows go at the BOTTOM of the tab so no saved check-off moves; changing a
 * row's variant does not change its position either. Guarded; removed from the
 * repo right after it has run.   POST {key, dry?:true}
 */
import { googleToken, REPORT_SHEET, KEY } from "./_blp-sched-lib.mts";

const TAB = "Phase Checklists";
const ROWS: string[][] = [
 [
  "Cabinetry Cleaning and Prep",
  "work",
  "grand",
  "Prep",
  "Take before pics. Take pics throughout.",
  "",
  "<p>1. Take before pics. Take pics throughout.</p>",
  "",
  "",
  ""
 ],
 [
  "Cabinetry Cleaning and Prep",
  "work",
  "grand",
  "Prep",
  "Start a labeled box for small parts",
  "",
  "<p><b>Grand Cleaning - Refurb level</b></p><p>Start a labeled box for small parts.</p>",
  "",
  "",
  ""
 ],
 [
  "Cabinetry Cleaning and Prep",
  "work",
  "grand",
  "Prep",
  "Remove all cabinetry and the lid",
  "",
  "<p>Remove all cabinetry and lid.</p>",
  "",
  "",
  ""
 ],
 [
  "Cabinetry Cleaning and Prep",
  "work",
  "grand",
  "Action",
  "Remove the action, take it outside, blow it out well",
  "Compressed air, outside.",
  "<p>Remove action, take it outside, blow it out well with compressed air.</p>",
  "",
  "",
  ""
 ],
 [
  "Cabinetry Cleaning and Prep",
  "work",
  "grand",
  "Strings & pins",
  "Scotch-Brite the tuning pins, if necessary",
  "",
  "<p>Scotch-Brite the tuning pins, if necessary.</p>",
  "",
  "",
  ""
 ],
 [
  "Cabinetry Cleaning and Prep",
  "work",
  "grand",
  "Strings & pins",
  "Scotch-Brite the strings, if necessary",
  "",
  "<p>Scotch-Brite the strings, if necessary.</p>",
  "",
  "",
  ""
 ],
 [
  "Cabinetry Cleaning and Prep",
  "work",
  "grand",
  "Vacuum",
  "Brush and vacuum the plate, soundboard, strings, tuning pins and action cavity",
  "Old paint brush in one hand to stir up the dust, vacuum in the other.",
  "<p>Use an old paint brush with the vacuum: stir up as much dust and debris with one hand and vacuum it up with the other. Do this to as much of the plate, soundboard, strings, tuning pins, and action cavity as you can reach.</p>",
  "",
  "",
  ""
 ],
 [
  "Cabinetry Cleaning and Prep",
  "work",
  "grand",
  "Vacuum",
  "Vacuum under the soundboard",
  "Tops of the large support beams, above the rear leg, trapwork.",
  "<p>Vacuum under the soundboard: tops of the large support beams, above the rear leg, trapwork, etc.</p>",
  "",
  "",
  ""
 ],
 [
  "Cabinetry Cleaning and Prep",
  "work",
  "grand",
  "Soundboard",
  "Clean the soundboard — option 1 (soda blast) or option 2 (squeegees)",
  "Option 1: older boards with caked dust, clear coat gone, stains. Option 2: newer boards where the dust wipes off to a nicely lacquered finish. Keep cleaner off the coils of the bass strings.",
  "<p><b>Soundboard Cleaning: </b>How you do the next step will depend on what type of finish the soundboard and plate have and what condition they are in:</p><p><b>Option 1: </b>older pianos with dust really caked on the soundboard, clear coat on the soundboard is gone or in poor condition, sometimes with spills or stains, poor condition plate and soundboard:</p><p>Use masking tape to mask off all gold-colored, painted plate surfaces, with the exception of the tuning pin area.</p><p>Mask off black (graphite) surfaces in the center of bridges.</p><p>Put the piano up on its side and take it outside.</p><p>Soda blast the soundboard and bridges-be thorough enough that you don&#x27;t leave any streaks or stripes.</p><p>From a distance (so you don&#x27;t remove gold paint), soda blast around the tuning pins and other tight, hard-to-clean areas, at your discretion.* You need to find the happy-medium where the dust and debris is removed but the paint remains intact. The distance and pressure you use will vary from piano to piano.</p><p><b>Option 2:</b> newer/somewhat newer pianos with dust that, once removed with a comparatively easy swipe, reveals a nicely lacquered soundboard and plate:</p><p>Use the 3 soundboard squeegees with red felt (1 large, 1 medium, 1 small) to squeegee the soundboard:</p><p>Wearing ear protection, leave the vacuum running the whole time. Insert the squeegee, wipe the soundboard, pull it out and vacuum off the dust. Repeat, repeat, repeat.</p><p>Fold lots of pieces of paper towel to make lots of fairly small squares, then use these with a sharpened hammer shank and some cleaner to detail the soundboard. Push the little paper towel squares around on the soundboard with the hammer shank (and pull them out with tweezers when each square is saturated) until you&#x27;ve covered all of the soundboard. Be careful to avoid getting any cleaner on the coils of the bass strings.</p><p><i>*The goal is to minimize this, as it is time-consuming. As long as you&#x27;re not removing gold paint with the soda blaster, go for it in these hard-to-reach areas!</i></p>",
  "",
  "",
  ""
 ],
 [
  "Cabinetry Cleaning and Prep",
  "work",
  "grand",
  "Plate",
  "Polish the agraffe tops with Brite Boy (if there are agraffes)",
  "Tops only — the strings stay on, so don't worry about the sides.",
  "<p>If there are agraffes, polish them with brite-boy polish. Just polish the tops; since you&#x27;re not removing the strings, don&#x27;t worry about the sides.</p>",
  "",
  "",
  ""
 ],
 [
  "Cabinetry Cleaning and Prep",
  "work",
  "grand",
  "Plate",
  "Clean the plate with TSP",
  "Very little cleaner near the tuning pins — it can leak down a pin into the pinblock, and those pins would have to be replaced.",
  "<p>Clean the plate with TSP. Be conservative around the tuning pins to avoid allowing any cleaner to seep to the base of the tuning pins and into the pinblock underneath.</p><p><i>**Use very little cleaner around the tuning pins and the strings. If cleaner gets around the tuning pins, it can leak down the pin into the pinblock, and the pins would then have to be replaced.</i></p>",
  "",
  "",
  ""
 ],
 [
  "Cabinetry Cleaning and Prep",
  "work",
  "grand",
  "Plate",
  "Detail the plate and bridges with Q-tips",
  "A little plastic cup of cleaner; expect to go through 20–50 Q-tips or more.",
  "<p>Use Q-tips and a little plastic cup of cleaner to detail the plate and bridges in hard-to-reach areas. Go through 20-50 (or more!) Q-tips.</p><p><i>**Use very little cleaner around the tuning pins and the strings. If cleaner gets around the tuning pins, it can leak down the pin into the pinblock, and the pins would then have to be replaced.</i></p>",
  "",
  "",
  ""
 ],
 [
  "Cabinetry Cleaning and Prep",
  "work",
  "grand",
  "Dampers",
  "Clean the damper heads",
  "",
  "<p>Clean damper heads.</p>",
  "",
  "",
  ""
 ],
 [
  "Cabinetry Cleaning and Prep",
  "work",
  "grand",
  "Pedals & trapwork",
  "Clean and polish pedals with Brite Boy",
  "",
  "<p>8. Clean and polish pedals with Brite Boy</p>",
  "",
  "",
  ""
 ],
 [
  "Cabinetry Cleaning and Prep",
  "work",
  "grand",
  "Pedals & trapwork",
  "Lubricate trapwork",
  "",
  "<p>13. Lubricate trapwork</p>",
  "",
  "",
  ""
 ],
 [
  "Cabinetry Cleaning and Prep",
  "work",
  "grand",
  "Keys",
  "Vacuum keybed",
  "",
  "<p>9. Vacuum Keybed</p>",
  "",
  "",
  ""
 ],
 [
  "Cabinetry Cleaning and Prep",
  "work",
  "grand",
  "Keys",
  "Temporarily remove keys",
  "",
  "<p>10. Temporarily remove keys</p>",
  "",
  "",
  ""
 ],
 [
  "Cabinetry Cleaning and Prep",
  "work",
  "grand",
  "Keys",
  "Check if bushings need to be replaced",
  "",
  "<p>11. Check if bushings need to be replaced</p>",
  "",
  "",
  ""
 ],
 [
  "Cabinetry Cleaning and Prep",
  "work",
  "grand",
  "Keys",
  "Clean keys with Windex or TSP",
  "",
  "<p>14. Clean keys with windex or TSP</p>",
  "",
  "",
  ""
 ],
 [
  "Regulation",
  "work",
  "grand",
  "Pre-regulation",
  "Bedding",
  "",
  "<p><i>Remember, grand regulation is more of a circle rather than a line. There’s a lot of going back and re-checking steps along the way.</i></p><p><b>Pre-regulation</b></p><p>Bedding</p>",
  "",
  "",
  ""
 ],
 [
  "Regulation",
  "work",
  "grand",
  "Pre-regulation",
  "Whippen alignment",
  "Cushion to capstan, and jack / rep lever to knuckle.",
  "<p>Whippen alignment (cushion to capstan and jack/rep lever to knuckle).</p>",
  "",
  "",
  ""
 ],
 [
  "Regulation",
  "work",
  "grand",
  "Pre-regulation",
  "Key leveling",
  "",
  "<p>Key leveling</p>",
  "",
  "",
  ""
 ],
 [
  "Regulation",
  "work",
  "grand",
  "Pre-regulation",
  "Confirm plenty of dip, drop and spring strength",
  "Before starting the full regulation.",
  "<p>Before you start a full regulation, ensure plenty of dip, drop, and spring strength</p>",
  "",
  "",
  ""
 ],
 [
  "Regulation",
  "work",
  "grand",
  "Section ends — white keys only",
  "Set dip by the dip block: 10 mm (0.394\")",
  "White-key section ends only.",
  "<p><b>Perform the following on only white-key section ends:</b></p><p>Set your dip according to dip block: 10mm or 0.394&quot;.</p>",
  "",
  "",
  ""
 ],
 [
  "Regulation",
  "work",
  "grand",
  "Section ends — white keys only",
  "Set let-off by the let-off gauge",
  "",
  "<p><b>Perform the following on only white-key section ends:</b></p><p>Set let off according to let off gauge.</p>",
  "",
  "",
  ""
 ],
 [
  "Regulation",
  "work",
  "grand",
  "Section ends — white keys only",
  "Set jack position and rep lever height",
  "",
  "<p><b>Perform the following on only white-key section ends:</b></p><p>Set jack position and rep lever height.</p><p>-jack position reference</p>",
  "",
  "",
  ""
 ],
 [
  "Regulation",
  "work",
  "grand",
  "Section ends — white keys only",
  "Set drop according to let-off",
  "",
  "<p><b>Perform the following on only white-key section ends:</b></p><p>Set drop according to let off.</p>",
  "",
  "",
  ""
 ],
 [
  "Regulation",
  "work",
  "grand",
  "Section ends — white keys only",
  "Set hammer height by 0.020\"–0.030\" aftertouch",
  "",
  "<p><b>Perform the following on only white-key section ends:</b></p><p>Set hammer height according to 0.020&quot;-0.030&quot; aftertouch.</p>",
  "",
  "",
  ""
 ],
 [
  "Regulation",
  "work",
  "grand",
  "Section ends — white keys only",
  "Re-check rep lever and jack position",
  "",
  "<p><b>Perform the following on only white-key section ends:</b></p><p>Re-check rep lever and jack position.</p>",
  "",
  "",
  ""
 ],
 [
  "Regulation",
  "work",
  "grand",
  "Section ends — white keys only",
  "Finalize aftertouch",
  "Refine by adjusting hammer height — not dip or let-off.",
  "<p><b>Perform the following on only white-key section ends:</b></p><p>Finalizing Aftertouch: re-check aftertouch, refine aftertouch by adjusting hammer height, not by adjusting dip or let off.</p>",
  "",
  "",
  ""
 ],
 [
  "Regulation",
  "work",
  "grand",
  "Section ends — white keys only",
  "Set spring strength and checking",
  "",
  "<p><b>Perform the following on only white-key section ends:</b></p><p>Set spring strength and checking.</p>",
  "",
  "",
  ""
 ],
 [
  "Regulation",
  "work",
  "grand",
  "Full regulation",
  "Even out each section end with its pair",
  "Compromise, but slightly favor the higher one.",
  "<p><b>After the previous section has been completed on white section ends only, complete the following:</b></p><p>Even out each section end with its pair (compromise, but slightly favor the higher one). Each section could have a slightly different height, but now is the time to compromise the 2.</p>",
  "",
  "",
  ""
 ],
 [
  "Regulation",
  "work",
  "grand",
  "Full regulation",
  "Rough hammer line to the section ends",
  "A quick pass.",
  "<p><b>After the previous section has been completed on white section ends only, complete the following:</b></p><p>ROUGH hammer line according to section ends-quick pass!</p>",
  "",
  "",
  ""
 ],
 [
  "Regulation",
  "work",
  "grand",
  "Full regulation",
  "Jack position and rep lever height",
  "",
  "<p><b>After the previous section has been completed on white section ends only, complete the following:</b></p><p>Jack position and rep lever height.</p>",
  "",
  "",
  ""
 ],
 [
  "Regulation",
  "work",
  "grand",
  "Full regulation",
  "Let-off with the jig",
  "",
  "<p><b>After the previous section has been completed on white section ends only, complete the following:</b></p><p>Let off with jig.</p>",
  "",
  "",
  ""
 ],
 [
  "Regulation",
  "work",
  "grand",
  "Full regulation",
  "Drop",
  "",
  "<p><b>After the previous section has been completed on white section ends only, complete the following:</b></p><p>Drop.</p>",
  "",
  "",
  ""
 ],
 [
  "Regulation",
  "work",
  "grand",
  "Full regulation",
  "Spring strength",
  "",
  "<p><b>After the previous section has been completed on white section ends only, complete the following:</b></p><p>Spring strength.</p>",
  "",
  "",
  ""
 ],
 [
  "Regulation",
  "work",
  "grand",
  "Full regulation",
  "Checking",
  "",
  "<p><b>After the previous section has been completed on white section ends only, complete the following:</b></p><p>Checking.</p>",
  "",
  "",
  ""
 ],
 [
  "Regulation",
  "work",
  "grand",
  "Full regulation",
  "Re-check jack position and rep lever height",
  "",
  "<p><b>After the previous section has been completed on white section ends only, complete the following:</b></p><p>Re-check jack position and rep lever height.</p>",
  "",
  "",
  ""
 ],
 [
  "Regulation",
  "work",
  "grand",
  "Full regulation",
  "Refine the hammer line",
  "With the help of the fallboard and key slip.",
  "<p><b>After the previous section has been completed on white section ends only, complete the following:</b></p><p>Refine hammer line with the help of fallboard &amp; key slip.</p>",
  "",
  "",
  ""
 ],
 [
  "Regulation",
  "work",
  "grand",
  "Full regulation",
  "Set dip by 0.020\"–0.030\" aftertouch",
  "No dip block here — use a gauge or punchings.",
  "<p><b>After the previous section has been completed on white section ends only, complete the following:</b></p><p>Dip: don&#x27;t use dip block, but set your dip according to 0.020&quot;-0.030&quot; aftertouch. Use a gauge or punchings.</p>",
  "",
  "",
  ""
 ]
];
const TO_ALL = [207, 208, 209, 210, 211, 212, 213, 214, 215, 216, 218, 219, 220, 221, 222, 223];
const SHARED_PHASES: Record<number, string> = {};
for (let n = 207; n <= 216; n++) SHARED_PHASES[n] = "Action Problems and Hammer Prep";
for (let n = 217; n <= 223; n++) SHARED_PHASES[n] = "Action Lubrication and Alignment";

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
    const r = await fetch(`${api}/values/${encodeURIComponent(`'${TAB}'!A1:J600`)}`, { headers: auth });
    if (!r.ok) return out({ error: "read " + r.status }, 502);
    const v = ((await r.json()) as { values?: string[][] }).values || [];
    const cell = (row: number, col: number) => String((v[row - 1] || [])[col] || "").trim();
    const last = v.length;
    const problems: string[] = [];
    if (cell(1, 0) !== "Phase") problems.push("row 1 is not the header");
    if (last !== 259) problems.push("expected the tab to end at row 259, it ends at " + last);
    if (v.some((x) => String(x[2] || "").trim().toLowerCase() === "grand" && (String(x[0] || "").trim() === "Cabinetry Cleaning and Prep" || String(x[0] || "").trim() === "Regulation"))) problems.push("already seeded (grand refurb rows exist)");
    for (let n = 207; n <= 223; n++) {
      if (cell(n, 0) !== SHARED_PHASES[n]) problems.push("row " + n + " is not a " + SHARED_PHASES[n] + " row");
      if (cell(n, 2).toLowerCase() !== "upright") problems.push("row " + n + " variant is " + (cell(n, 2) || "(blank)") + ", expected upright");
    }
    if (cell(217, 4).indexOf("Blow out action") !== 0) problems.push("row 217 is not the blow-out step");
    for (let n = 224; n <= 231; n++) if (cell(n, 0) !== "Regulation" || cell(n, 2).toLowerCase() !== "upright") problems.push("row " + n + " is not an upright Regulation row");
    const first = last + 1, lastNew = last + ROWS.length;
    if (problems.length || b.dry) return out({ ok: !problems.length, dry: true, problems, lastRow: last, wouldWriteRows: [first, lastNew], count: ROWS.length, toAll: TO_ALL });
    const data = [{ range: `'${TAB}'!A${first}:J${lastNew}`, values: ROWS },
      { range: `'${TAB}'!C207:C216`, values: Array.from({ length: 10 }, () => ["all"]) },
      { range: `'${TAB}'!C218:C223`, values: Array.from({ length: 6 }, () => ["all"]) }];
    const put = () => fetch(`${api}/values:batchUpdate`, { method: "POST", headers: auth, body: JSON.stringify({ valueInputOption: "RAW", data }) });
    let w = await put(), txt = w.ok ? "" : await w.text();
    if (!w.ok && /exceeds grid limits/i.test(txt)) {
      const meta = await (await fetch(`${api}?fields=sheets.properties`, { headers: auth })).json() as { sheets: Array<{ properties: { title: string; sheetId: number } }> };
      const sid = (meta.sheets.find((s) => s.properties.title === TAB) || { properties: { sheetId: -1 } }).properties.sheetId;
      if (sid < 0) return out({ error: "tab not found" }, 502);
      const g = await fetch(`${api}:batchUpdate`, { method: "POST", headers: auth, body: JSON.stringify({ requests: [{ appendDimension: { sheetId: sid, dimension: "ROWS", length: 60 } }] }) });
      if (!g.ok) return out({ error: "grow " + g.status }, 502);
      w = await put(); txt = w.ok ? "" : await w.text();
    }
    return out({ ok: w.ok, wroteRows: w.ok ? [first, lastNew] : null, variantsToAll: w.ok ? TO_ALL.length : 0, error: w.ok ? undefined : txt.slice(0, 200) }, w.ok ? 200 : 502);
  } catch (e) {
    return out({ error: String((e as Error).message || e).slice(0, 200) }, 500);
  }
};

export const config = { path: "/.netlify/functions/checklist-seed-grand-refurb" };
