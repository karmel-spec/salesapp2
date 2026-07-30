import { ensureTab, readTab, writeTab } from "./sheets";

/**
 * Inbox folders — buckets the team files client responses into as the
 * response page grows to cover ALL of BLP's inbound traffic (tuning,
 * moving, leads, …). Stored in an "Inbox Folders" tab so every device
 * shares one list. The general "Inbox" (unfiled) is implicit.
 */

const TAB = "Inbox Folders";
const HEADER = ["name", "createdBy", "createdAt"];
export const DEFAULT_FOLDERS = ["Leads", "Tuning", "Moving"];

export async function listFolders(): Promise<string[]> {
  const rows = await readTab(TAB);
  const custom = rows
    .slice(1)
    .map((r) => (r[0] || "").toString().trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const all: string[] = [];
  for (const f of [...DEFAULT_FOLDERS, ...custom]) {
    const k = f.toLowerCase();
    if (!seen.has(k)) {
      seen.add(k);
      all.push(f);
    }
  }
  return all;
}

/**
 * Auto-categorize an inbound client response. Message content wins (a sales
 * lead can still ask about a tuning); the lead's type/headline breaks ties;
 * anything else attached to a lead files under "Leads". Patterns are
 * deliberately conservative — "moving forward" must NOT land in Moving.
 */
export function autoFolder(leadType: string, headline: string, messageText: string): string {
  const msg = ` ${messageText.toLowerCase()} `;
  const ctx = ` ${leadType.toLowerCase()} ${headline.toLowerCase()} `;
  const tuning = /\btun(?:ing|ed?|er)\b|pitch raise/;
  const moving =
    /piano[^.]{0,40}\bmov(?:e|ing|ed)\b|\bmov(?:e|ing|ed)\b[^.]{0,40}piano|\bmovers?\b|\bdeliver(?:y|ed|ing)?\b|\bhaul/;
  if (tuning.test(msg)) return "Tuning";
  if (moving.test(msg)) return "Moving";
  if (tuning.test(ctx)) return "Tuning";
  if (/\bmov(?:e|ing|es)\b/.test(ctx)) return "Moving";
  return "Leads";
}

export async function addFolder(name: string, who: string): Promise<string[]> {
  const clean = name.trim().slice(0, 40);
  if (!clean) throw new Error("Folder name is empty");
  await ensureTab(TAB);
  const rows = await readTab(TAB);
  const existing = rows.length ? rows : [HEADER];
  const names = new Set(
    [...DEFAULT_FOLDERS, ...existing.slice(1).map((r) => (r[0] || "").toString())].map((f) => f.toLowerCase())
  );
  if (!names.has(clean.toLowerCase())) {
    existing.push([clean, who, new Date().toISOString()]);
    await writeTab(TAB, existing);
  }
  return listFolders();
}
