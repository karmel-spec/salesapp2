import fs from "node:fs";
import { getLeads, getLead, createLead, appendTimeline, updateLeadFields, updateTimelineEvent, archiveInbound } from "../src/lib/leads";

const pairs: { name: string; phone: string; date: string }[] = JSON.parse(
  fs.readFileSync("/private/tmp/claude-501/-Users-ivorylarson/12d77502-1454-46b9-bccd-a332ab7c9eff/scratchpad/sc-name-phone.json", "utf8")
);
const pretty = (d: string) => `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// Sheets allows 60 reads/min/user; each update reads the row first. Pace + back off on 429.
async function paced<T>(fn: () => Promise<T>): Promise<T> {
  for (let i = 0; ; i++) {
    try { const v = await fn(); await sleep(1300); return v; }
    catch (e) { if (i < 4 && /429|quota/i.test(String(e))) { console.log("  quota — waiting 65s"); await sleep(65000); continue; } throw e; }
  }
}
const first = (s: string) => (s || "").trim().split(/\s+/)[0]?.toLowerCase() || "";

async function main() {
  const { leads, shape } = await getLeads(true);
  let fixed = 0, ambiguous: string[] = [], unmatched: string[] = [];
  for (const l of leads) {
    if (!/SalesCaptain/i.test(l.source || "")) continue;
    const digits = (l.phone || "").replace(/\D/g, "");
    if (!/^1\d{9}$/.test(digits)) continue;
    const nine = digits.slice(1);
    let cands = pairs.filter((p) => p.phone.startsWith(nine));
    if (cands.length > 1) cands = cands.filter((p) => first(p.name) === first(l.name));
    const phones = [...new Set(cands.map((p) => p.phone))];
    if (phones.length === 1) {
      await paced(() => updateLeadFields(l, shape, { phone: pretty(phones[0]) }));
      fixed++;
      console.log(`fixed ${l.name.padEnd(28)} ${l.phone} → ${pretty(phones[0])}`);
    } else if (phones.length > 1) ambiguous.push(`${l.name} ${digits} → ${phones.join("/")}`);
    else unmatched.push(`${l.name} ${digits}`);
  }
  console.log(`\nfixed ${fixed}; ambiguous ${ambiguous.length}; unmatched ${unmatched.length}`);
  ambiguous.forEach((a) => console.log("  ambiguous:", a));
  unmatched.forEach((u) => console.log("  unmatched:", u));

  // Carlos split: the Sep 11 message came from a different Carlos (+1 313 420 7681).
  const c1 = (await getLeads(true)).leads.find((l) => l.id === "blp-4c54cbcbe9");
  if (c1) {
    const idx = c1.timeline.findIndex((e) => e.kind === "inbound" && /restored 1922 grand/i.test(e.text || ""));
    if (idx >= 0) {
      const ev = c1.timeline[idx];
      const already = (await getLeads(true)).leads.find((l) => l.phoneDialable.endsWith("3134207681"));
      let newId = already?.id;
      if (!newId) {
        newId = await createLead({
          firstName: "Carlos", lastName: "", phone: "(313) 420-7681",
          headline: "How much is a restored 1922 grand piano with over jeys",
          source: "Main line (SalesCaptain)", inquiryMethod: "Text", status: "Support", capturedBy: "app",
        });
        const created = await getLead(newId);
        if (created) await appendTimeline(created.lead, created.shape, { at: ev.at, who: "Carlos", kind: "inbound", source: ev.source || "salescaptain", folder: ev.folder, text: ev.text });
      }
      const fresh = await getLead(c1.id);
      if (fresh) {
        await updateTimelineEvent(fresh.lead, fresh.shape, idx, `↪ Moved to the other Carlos (313) 420-7681 — a different customer with the same first name. Original: ${ev.text}`, "app");
        const again = await getLead(c1.id);
        if (again) await archiveInbound(again.lead, again.shape, [ev.at], "app", true);
      }
      console.log(`Carlos split: message moved to ${newId}`);
    } else console.log("Carlos split: Sep 11 message not found on blp-4c54cbcbe9 (already moved?)");
  }

  // Close out the disposable production intake test contact.
  const test = (await getLeads(true)).leads.find((l) => /^Zz Intake Test/i.test(l.name));
  if (test) { await updateLeadFields(test, shape, { status: "Unqualified — console intake test 9/11", headline: "Console intake test — ignore" }); console.log("test contact closed:", test.id); }
}
main().catch((e) => { console.error("FAILED", e); process.exit(1); });
