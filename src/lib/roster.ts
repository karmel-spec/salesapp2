import { ensureTab, readTab, writeTab } from "./sheets";

/**
 * Team roster — the people in the "Who are you?" picker and every rep
 * dropdown. Stored in a "Team Roster" sheet tab so admins add/remove
 * teammates from Settings without a code change. Falls back to the
 * built-in list until the tab exists.
 */

const TAB = "Team Roster";
const HEADER = ["name", "addedBy", "addedAt"];

export const DEFAULT_ROSTER = ["Brigham", "Karmel", "Arnold", "Melissa", "Alisa", "Susie", "Ezzy", "Lisa"];

export async function listRoster(): Promise<string[]> {
  const rows = await readTab(TAB);
  const names = rows
    .slice(1)
    .map((r) => (r[0] || "").toString().trim())
    .filter(Boolean);
  return names.length ? names : [...DEFAULT_ROSTER];
}

/** First write seeds the tab with the defaults so nothing silently vanishes. */
async function loadOrSeed(): Promise<string[][]> {
  await ensureTab(TAB);
  const rows = await readTab(TAB);
  if (rows.length > 1) return rows;
  const now = new Date().toISOString();
  return [HEADER, ...DEFAULT_ROSTER.map((n) => [n, "app (seed)", now])];
}

export async function addPerson(name: string, who: string): Promise<string[]> {
  const clean = name.trim().slice(0, 40);
  if (!clean) throw new Error("Name is empty");
  const rows = await loadOrSeed();
  if (rows.slice(1).some((r) => (r[0] || "").toString().trim().toLowerCase() === clean.toLowerCase())) {
    throw new Error(`"${clean}" is already on the team list`);
  }
  rows.push([clean, who, new Date().toISOString()]);
  await writeTab(TAB, rows);
  return rows.slice(1).map((r) => r[0].toString());
}

export async function removePerson(name: string): Promise<string[]> {
  const clean = name.trim().toLowerCase();
  const rows = await loadOrSeed();
  const kept = rows.filter((r, i) => i === 0 || (r[0] || "").toString().trim().toLowerCase() !== clean);
  if (kept.length === rows.length) throw new Error(`"${name}" isn't on the team list`);
  if (kept.length === 1) throw new Error("Can't remove the last person on the list");
  await writeTab(TAB, kept);
  return kept.slice(1).map((r) => r[0].toString());
}
