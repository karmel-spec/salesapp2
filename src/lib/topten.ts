import { ensureTab, readTab, writeTab } from "./sheets";

/**
 * Arnold's daily Top Ten — the ten most promising revenue leads, picked for
 * the morning brief. The brief process saves them here; the ⭐ TOP 10 button
 * on the Leads page reads them. One list at a time (today's).
 */

const TAB = "Top Ten";
const HEADER = ["rank", "leadId", "leadName", "reason", "savedAt", "savedBy"];

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

export async function getTopTen(): Promise<TopTenList | null> {
  const rows = await readTab(TAB);
  const items = rows
    .slice(1)
    .map((r) => ({
      rank: Number(r[0]) || 0,
      leadId: (r[1] || "").toString().trim(),
      leadName: (r[2] || "").toString(),
      reason: (r[3] || "").toString(),
      savedAt: (r[4] || "").toString(),
      savedBy: (r[5] || "").toString(),
    }))
    .filter((x) => x.leadId)
    .sort((a, b) => a.rank - b.rank);
  if (!items.length) return null;
  return {
    savedAt: items[0].savedAt,
    savedBy: items[0].savedBy,
    items: items.map(({ rank, leadId, leadName, reason }) => ({ rank, leadId, leadName, reason })),
  };
}

export async function saveTopTen(items: TopTenItem[], who: string): Promise<void> {
  if (!items.length) throw new Error("Top ten list is empty");
  await ensureTab(TAB);
  const now = new Date().toISOString();
  await writeTab(TAB, [
    HEADER,
    ...items
      .slice(0, 10)
      .map((x, i) => [String(x.rank || i + 1), x.leadId, x.leadName.slice(0, 60), x.reason.slice(0, 300), now, who]),
  ]);
}
