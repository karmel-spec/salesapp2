import { ensureTab, readTab, writeTab } from "./sheets";

/**
 * Arnold's daily Top Ten — the ten most promising revenue leads, picked for
 * the morning brief. The brief process saves them here; the ⭐ TOP 10 button
 * on the Leads page reads them. One list at a time (today's).
 */

const TAB = "Top Ten";
const HEADER = ["rank", "leadId", "leadName", "reason", "savedAt", "savedBy", "scope"];

/** Which work screen a list belongs to: Brigham's (BL Leads) or Arnold's own leads (Leads tab). */
export type TopTenScope = "brigham" | "arnold";
export const topTenScope = (raw: string | null | undefined): TopTenScope => (raw === "arnold" ? "arnold" : "brigham");

export interface TopTenItem {
  rank: number;
  leadId: string;
  leadName: string;
  reason: string;
}

export interface TopTenList {
  savedAt: string;
  savedBy: string;
  items: TopTenItem[];
}

/** scope column: "brigham" | "arnold" for list rows; "<scope>:seen" marks leads already offered today. */
interface Row { rank: number; leadId: string; leadName: string; reason: string; savedAt: string; savedBy: string; scope: string }

async function readRows(): Promise<Row[]> {
  const rows = await readTab(TAB);
  return rows
    .slice(1)
    .map((r) => ({
      rank: Number(r[0]) || 0,
      leadId: (r[1] || "").toString().trim(),
      leadName: (r[2] || "").toString(),
      reason: (r[3] || "").toString(),
      savedAt: (r[4] || "").toString(),
      savedBy: (r[5] || "").toString(),
      scope: (r[6] || "").toString().trim() || "brigham", // older rows have no scope → Brigham's
    }))
    .filter((x) => x.leadId);
}

export async function getTopTen(scope: TopTenScope = "brigham"): Promise<TopTenList | null> {
  const items = (await readRows()).filter((x) => x.scope === scope).sort((a, b) => a.rank - b.rank);
  if (!items.length) return null;
  return {
    savedAt: items[0].savedAt,
    savedBy: items[0].savedBy,
    items: items.map(({ rank, leadId, leadName, reason }) => ({ rank, leadId, leadName, reason })),
  };
}

/** Leads already offered on this scope's Top Ten today (previous lists) — "Next ten" skips them. */
export async function getSeen(scope: TopTenScope): Promise<Set<string>> {
  const cutoff = Date.now() - 24 * 3600_000;
  const rows = await readRows().catch(() => [] as Row[]);
  return new Set(rows.filter((x) => x.scope === `${scope}:seen` && Date.parse(x.savedAt) > cutoff).map((x) => x.leadId));
}

export async function saveTopTen(
  items: TopTenItem[],
  who: string,
  scope: TopTenScope = "brigham",
  opts: { clearSeen?: boolean; addSeen?: string[] } = {}
): Promise<void> {
  if (!items.length) throw new Error("Top ten list is empty");
  await ensureTab(TAB);
  const now = new Date().toISOString();
  const cutoff = Date.now() - 24 * 3600_000;
  // Keep the other scope's rows untouched; drop this scope's list, and its
  // "seen" markers when the day starts over (the morning brief) or when stale.
  const keep = (await readRows().catch(() => [] as Row[])).filter(
    (x) => x.scope !== scope && !(x.scope === `${scope}:seen` && (opts.clearSeen || Date.parse(x.savedAt) < cutoff))
  );
  const seen = (opts.addSeen || []).map((id) => ["0", id, "", "", now, who, `${scope}:seen`]);
  await writeTab(TAB, [
    HEADER,
    ...keep.map((x) => [String(x.rank), x.leadId, x.leadName, x.reason, x.savedAt, x.savedBy, x.scope]),
    ...seen,
    ...items
      .slice(0, 10)
      .map((x, i) => [String(x.rank || i + 1), x.leadId, x.leadName.slice(0, 60), x.reason.slice(0, 300), now, who, scope]),
  ]);
}
