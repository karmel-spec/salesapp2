import { ensureTab, readTab, writeTab } from "./sheets";

/**
 * Inbox folders — buckets the team files client responses into. Each folder
 * belongs to one of the two inboxes: "sales" (replies to sales-lead work)
 * or "general" (all other BLP traffic). Stored in an "Inbox Folders" tab;
 * the general 📥 Inbox (unfiled) is implicit.
 */

const TAB = "Inbox Folders";
const HEADER = ["name", "tab", "createdBy", "createdAt"];

export interface Folder {
  name: string;
  tab: "sales" | "general";
}

export const DEFAULT_FOLDERS: Folder[] = [
  { name: "Leads", tab: "sales" },
  { name: "Tuning", tab: "general" },
  { name: "Moving", tab: "general" },
];

export async function listFolders(): Promise<Folder[]> {
  const rows = await readTab(TAB);
  const header = rows[0] || [];
  const tabCol = header.indexOf("tab");
  const custom: Folder[] = rows
    .slice(1)
    .map((r) => ({
      name: (r[0] || "").toString().trim(),
      tab: ((tabCol >= 0 ? r[tabCol] : "") || "general").toString().trim().toLowerCase() === "sales" ? "sales" as const : "general" as const,
    }))
    .filter((f) => f.name);
  const seen = new Set<string>();
  const all: Folder[] = [];
  for (const f of [...DEFAULT_FOLDERS, ...custom]) {
    const k = f.name.toLowerCase();
    if (!seen.has(k)) {
      seen.add(k);
      all.push(f);
    }
  }
  return all;
}

export async function addFolder(name: string, tab: "sales" | "general", who: string): Promise<Folder[]> {
  const clean = name.trim().slice(0, 40);
  if (!clean) throw new Error("Folder name is empty");
  await ensureTab(TAB);
  const rows = await readTab(TAB);
  const existing = rows.length ? rows : [HEADER];
  // Migrate legacy 3-column rows in place if the tab column is missing.
  if (existing[0].indexOf("tab") < 0) {
    existing[0] = [...HEADER];
    for (let i = 1; i < existing.length; i++) {
      existing[i] = [existing[i][0] || "", "general", existing[i][1] || "", existing[i][2] || ""];
    }
  }
  const names = new Set(
    [...DEFAULT_FOLDERS.map((f) => f.name), ...existing.slice(1).map((r) => (r[0] || "").toString())].map((f) =>
      f.toLowerCase()
    )
  );
  if (!names.has(clean.toLowerCase())) {
    existing.push([clean, tab, who, new Date().toISOString()]);
    await writeTab(TAB, existing);
  }
  return listFolders();
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
