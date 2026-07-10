/**
 * Stage 2 of the one-time SalesCaptain backfill.
 *
 * Reads /tmp/sc-history.json (stage 1), matches each message to an ACTIVE
 * lead (phone → exact name → name-contains), and adds any missing ones to
 * that lead's timeline as informational history notes.
 *
 * Deliberately conservative, so it can't churn the pipeline:
 *  - only new/active leads are touched
 *  - entries are kind "note" (NOT a contact kind): they do NOT reset the
 *    quiet clock, do NOT flip a lead to "our turn", do NOT wake Arnold
 *  - dedup by a stable [sc:date|token] marker embedded in the note, so
 *    re-running is safe and won't double-post
 *  - one sheet write per lead, paced under the Sheets quota
 */
import fs from "node:fs";

// Load env then the app libs (they read config at import).
const raw = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
for (const m of raw.matchAll(/^([A-Z0-9_]+)=(?:"([\s\S]*?)"|'([\s\S]*?)'|(.*))$/gm)) {
  process.env[m[1]] = m[2] ?? m[3] ?? m[4] ?? "";
}
const { getLeads, invalidateCache } = await import("../src/lib/leads.ts");
const { writeCells } = await import("../src/lib/sheets.ts");

const records = JSON.parse(fs.readFileSync("/tmp/sc-history.json", "utf8"));
const { leads, shape } = await getLeads(true);
const active = leads.filter((l) => l.statusBucket === "new" || l.statusBucket === "active");

const byPhone = new Map();
const byName = new Map();
for (const l of active) {
  if (l.phoneDialable) byPhone.set(l.phoneDialable.slice(-10), l);
  if (l.name && l.name !== "(no name)") byName.set(l.name.toLowerCase(), l);
}
const nameList = [...byName.keys()];

function matchLead(rec) {
  if (rec.phone && byPhone.has(rec.phone)) return byPhone.get(rec.phone);
  if (rec.name) {
    const n = rec.name.toLowerCase().trim();
    if (byName.has(n)) return byName.get(n);
    const hit = nameList.find((nm) => nm.length > 4 && (n.includes(nm) || nm.includes(n)));
    if (hit) return byName.get(hit);
  }
  return null;
}

// Group matched records per lead.
const perLead = new Map();
let matchedRecs = 0;
for (const rec of records) {
  const lead = matchLead(rec);
  if (!lead) continue;
  matchedRecs++;
  if (!perLead.has(lead.id)) perLead.set(lead.id, { lead, recs: [] });
  perLead.get(lead.id).recs.push(rec);
}

const timelineCol = shape.col.timelineJson;
const activityCol = shape.col.appActivity;
const line = (ev) => `[${new Date(ev.at).toLocaleDateString("en-US")} ${ev.who} · ${ev.kind}] ${ev.text}`;
const marker = (rec) => `sc:${(rec.date || "").slice(0, 10)}|${(rec.name || rec.phone || "").toLowerCase().slice(0, 18)}`;

let leadsTouched = 0;
let eventsAdded = 0;
for (const { lead, recs } of perLead.values()) {
  const timeline = [...lead.timeline];
  const existing = new Set(
    timeline.filter((e) => /\[sc:/.test(e.text)).map((e) => (e.text.match(/\[sc:[^\]]+\]/) || [""])[0])
  );
  let added = 0;
  for (const rec of recs) {
    const key = `[${marker(rec)}]`;
    if (existing.has(key)) continue;
    existing.add(key);
    const when = rec.text ? `"${rec.text}"` : "(message text not in the notification)";
    timeline.push({
      at: rec.date || new Date().toISOString(),
      who: lead.name,
      kind: "note",
      text: `💬 SalesCaptain history — customer message ${when} ${key}`,
    });
    added++;
  }
  if (!added) continue;
  timeline.sort((a, b) => (a.at < b.at ? -1 : 1));
  await writeCells([
    { row: lead.row, col: timelineCol, value: JSON.stringify(timeline) },
    { row: lead.row, col: activityCol, value: timeline.map(line).join("\n") },
  ]);
  leadsTouched++;
  eventsAdded += added;
  console.log(`  ${lead.name}: +${added}`);
  await new Promise((r) => setTimeout(r, 1200)); // stay under the sheets write quota
}
invalidateCache();
console.log(`\nBACKFILL DONE — ${records.length} SC messages scanned, ${matchedRecs} matched active leads, ${eventsAdded} new history notes added across ${leadsTouched} leads.`);
