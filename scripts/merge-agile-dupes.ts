/**
 * One-off (Aug 2026): merge "Agile Lead Task" rows that duplicate real leads.
 * The primary lead gets a merge note carrying over the Agile task text; the
 * Agile row is closed as "duplicate of <id>" (kept in the sheet, not deleted).
 * Rows with conflicting contact info are flagged instead of merged.
 * Run: npx tsx --env-file=.env.local scripts/merge-agile-dupes.ts
 */
import { getLeads, appendTimeline, updateLeadFields, ensureAppColumns, type Lead } from "../src/lib/leads";

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const digits = (s: string) => s.replace(/\D/g, "").slice(-10);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const { leads, shape } = await getLeads(true);
  const s = await ensureAppColumns(shape);
  const isAgile = (l: Lead) => (l.leadType || "").trim().toLowerCase() === "agile lead task";
  const agile = leads.filter(isAgile);
  const others = leads.filter((l) => !isAgile(l));

  const byEmail = new Map<string, Lead[]>();
  const byName = new Map<string, Lead[]>();
  for (const l of others) {
    const e = (l.emailClean || "").toLowerCase();
    if (e) byEmail.set(e, [...(byEmail.get(e) || []), l]);
    const n = norm(l.name);
    if (n.length >= 5) byName.set(n, [...(byName.get(n) || []), l]);
  }

  let merged = 0;
  const flagged: string[] = [];
  for (const a of agile) {
    if ((a.status || "").toLowerCase().includes("duplicate")) continue; // already merged
    const e = (a.emailClean || "").toLowerCase();
    const n = norm(a.name);
    const hit = (e && byEmail.get(e)?.[0]) || (n.length >= 5 && byName.get(n)?.[0]) || undefined;
    if (!hit) continue;

    // Same name but contradictory contact info = possibly two different people.
    const ap = digits(a.phone);
    const hp = digits(hit.phone);
    const ae = (a.emailClean || "").toLowerCase();
    const he = (hit.emailClean || "").toLowerCase();
    if ((ap.length === 10 && hp.length === 10 && ap !== hp) || (ae && he && ae !== he)) {
      flagged.push(`${a.name}: agile ${a.id} (${a.phone || a.email}) vs ${hit.id} (${hit.phone || hit.email})`);
      continue;
    }

    const carry = [a.headline, a.notes].filter(Boolean).join(" — ").slice(0, 300);
    await appendTimeline(hit, s, {
      at: new Date().toISOString(),
      who: "app",
      kind: "note",
      text: `🔗 Merged duplicate Agile task row ${a.id} into this lead.${carry ? ` Carried over: "${carry}"` : ""}`,
    });
    await sleep(1200);

    const stamp = new Date();
    const noteText = `🔗 Closed as duplicate of ${hit.id} (${hit.name}) — Agile task merged there.`;
    const line = `[${stamp.toLocaleDateString("en-US")} app · note] ${noteText}`;
    const timeline = [...a.timeline, { at: stamp.toISOString(), who: "app", kind: "note", text: noteText }];
    await updateLeadFields(a, s, {
      status: `Closed - duplicate of ${hit.id}`,
      timelineJson: JSON.stringify(timeline),
      appActivity: a.appActivity ? `${a.appActivity}\n${line}` : line,
    });
    merged++;
    console.log(`merged: ${a.name} (${a.id}) → ${hit.name} (${hit.id})`);
    await sleep(1200);
  }
  console.log(`\nDone. Merged ${merged} duplicates.`);
  if (flagged.length) console.log(`Flagged for manual review (conflicting contact info):\n  ${flagged.join("\n  ")}`);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
