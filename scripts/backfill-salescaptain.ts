/**
 * Backfill SalesCaptain notification emails into the Sales Console.
 *
 *   npx tsx --env-file=.env.local scripts/backfill-salescaptain.ts \
 *     --account karmel@brighamlarsonpianos.com --since 2026-08-01 --query "Lillian Harnden" [--apply] [--prod] [--known-only]
 *
 * --known-only: only post alerts whose sender is already a lead in the Leads
 * Log (exact full name, first+last, or phone). Unknown names are listed but
 * never posted, so no new Support contacts get created.
 *
 * Dry-run by default: prints each parsed alert and what the console would
 * do. --apply POSTs to /api/salescaptain/inbound (local dev server unless
 * --prod), which dedupes on the alert's RFC Message-ID — rerunning is safe.
 */
import { searchMessages, getMessage } from "../netlify/functions/lib/gmail-dwd";
import { parseSalesCaptainAlert } from "../netlify/functions/lib/salescaptain-alert";
import { getLeads } from "../src/lib/leads";

const arg = (k: string, d = "") => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] || "" : d; };
const account = arg("--account", "karmel@brighamlarsonpianos.com");
const since = arg("--since", "2026-08-01");
const query = arg("--query", "");
const apply = process.argv.includes("--apply");
const base = process.argv.includes("--prod") ? "https://blpsalesapp.netlify.app" : "http://localhost:8790";
const key = process.env.BLP_ARNOLD_ACCESS_KEY || "";
const knownOnly = process.argv.includes("--known-only");

async function knownMatcher() {
  const { leads } = await getLeads(true);
  const names = new Set<string>();
  const phones = new Set<string>();
  for (const l of leads) {
    if (l.name) names.add(l.name.trim().toLowerCase());
    if (l.firstName && l.lastName) names.add(`${l.firstName} ${l.lastName}`.trim().toLowerCase());
    const d = (l.phoneDialable || "").replace(/\D/g, "");
    if (d.length >= 10) phones.add(d.slice(-10));
  }
  // A bare first name ("Carol") matching a lead called "Carol" is not proof
  // it's the same person, so known-only requires a first AND last name (or a phone).
  const fullName = (n: string) => /\s/.test(n.trim()) && !n.includes("@");
  return (name: string, phone: string) => (!!name && fullName(name) && names.has(name.trim().toLowerCase())) || (!!phone && phones.has(phone));
}

async function main() {
  const q = `from:no-reply@salescaptain.com after:${since.replace(/-/g, "/")}${query ? ` "${query}"` : ""}`;
  const ids = await searchMessages(account, q, 2000);
  console.log(`${account}: ${ids.length} alert(s) match ${JSON.stringify(q)} — ${apply ? "APPLYING to " + base : "dry run"}`);
  const isKnown = knownOnly ? await knownMatcher() : () => true;
  let posted = 0, dup = 0, skip = 0, unknown = 0;
  const unknownNames = new Map<string, number>();
  for (const id of ids.reverse()) {
    const m = await getMessage(account, id);
    const p = parseSalesCaptainAlert(m.subject, m.text);
    const when = p?.sentAt || new Date(m.internalDate).toISOString();
    if (!p || (!p.senderName && !p.senderPhone)) { skip++; console.log(`  SKIP ${when} unparsed: ${m.subject} :: ${m.text.slice(0, 80)}`); continue; }
    if (query && !new RegExp(query.replace(/\s+/g, "\\s+"), "i").test(`${p.senderName} ${p.messageText}`)) { skip++; continue; }
    if (!isKnown(p.senderName, p.senderPhone)) {
      unknown++;
      const k = p.senderName || p.senderPhone;
      unknownNames.set(k, (unknownNames.get(k) || 0) + 1);
      continue;
    }
    console.log(`  ${when} [${p.format}/${p.channel}] ${p.senderName || p.senderPhone}${p.photo ? " 📷" : ""}: ${p.messageText.slice(0, 110)}`);
    if (!apply) continue;
    const r = await fetch(`${base}/api/salescaptain/inbound`, {
      method: "POST", headers: { "content-type": "application/json", "x-blp-key": key },
      body: JSON.stringify({ senderName: p.senderName, senderPhone: p.senderPhone, messageText: p.messageText, at: when, channel: p.channel === "salescaptain" ? undefined : p.channel, photo: p.photo, sourceMessageId: m.rfcMessageId, account, backfill: true }),
    });
    const out = (await r.json().catch(() => ({}))) as { duplicate?: boolean; matched?: boolean; created?: boolean; leadName?: string; how?: string; error?: string };
    if (!r.ok) console.log(`     ✗ ${r.status} ${out.error || ""}`);
    else if (out.duplicate) { dup++; console.log(`     = duplicate on ${out.leadName}`); }
    else { posted++; console.log(`     ✓ ${out.created ? "created contact" : `→ ${out.leadName} (${out.how})`}`); }
    await new Promise((r) => setTimeout(r, 1500)); // sheet quota (route re-reads the sheet per post)
  }
  if (knownOnly) {
    console.log(`\nnot in Leads Log (not posted): ${unknown} alert(s) from ${unknownNames.size} sender(s)`);
    for (const [k, n] of [...unknownNames.entries()].sort((a, b) => b[1] - a[1])) console.log(`    ${String(n).padStart(3)}  ${k}`);
  }
  console.log(`done: posted ${posted}, duplicates ${dup}, skipped ${skip}, unknown ${unknown}`);
}
main().catch((e) => { console.error("FAILED", e); process.exit(1); });
