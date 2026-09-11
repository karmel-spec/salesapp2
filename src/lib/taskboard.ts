/**
 * Store Map task boards (Supabase `tb_cards`, same project as the sales
 * app's storage). Read-only here: open cards per owner for the Team Inbox
 * Board. "Open" mirrors the Store Map UI: not done/archived and not snoozed.
 */

const URL_BASE = process.env.SUPABASE_URL || "";
const KEY = process.env.SUPABASE_SERVICE_KEY || "";

interface Card {
  owner: string;
  col: string;
  text: string;
  due: string; // YYYY-MM-DD or ""
  created: string;
  snooze: string; // YYYY-MM-DD or ""
}

export interface TaskItem {
  title: string;
  due: string;
  ageDays: number;
  overdue: boolean;
}

export interface TaskSummary {
  owner: string; // as written on the board, e.g. "Melissa Terry"
  open: number;
  askBrigham: number; // open cards sitting in the "Questions for Brigham" column
  overdue: number;
  oldestDays: number | null;
  oldest: TaskItem[]; // oldest open first
}

/** Per-owner summaries keyed by lowercased owner name. */
export async function taskSummaries(sample = 5): Promise<Map<string, TaskSummary>> {
  const out = new Map<string, TaskSummary>();
  if (!URL_BASE || !KEY) return out;
  const res = await fetch(`${URL_BASE}/rest/v1/tb_cards?select=owner,col,text,due,created,snooze&limit=5000`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Task board read failed (${res.status})`);
  const cards = (await res.json()) as Card[];
  const today = new Date().toISOString().slice(0, 10);
  const byOwner = new Map<string, Card[]>();
  for (const c of cards) {
    const open = c.col !== "done" && c.col !== "archived" && !(c.snooze && c.snooze > today);
    if (!open) continue;
    const key = (c.owner || "").trim().toLowerCase();
    if (!key) continue;
    if (!byOwner.has(key)) byOwner.set(key, []);
    byOwner.get(key)!.push(c);
  }
  for (const [key, list] of byOwner) {
    list.sort((a, b) => new Date(a.created).getTime() - new Date(b.created).getTime());
    const items = list.slice(0, sample).map((c) => ({
      title: c.text.replace(/\s+/g, " ").trim().slice(0, 90) || "(untitled card)",
      due: c.due,
      ageDays: Math.max(0, Math.round((Date.now() - new Date(c.created).getTime()) / 864e5)),
      overdue: Boolean(c.due && c.due < today),
    }));
    out.set(key, {
      owner: list[0].owner,
      open: list.length,
      askBrigham: list.filter((c) => c.col === "askbrigham").length,
      overdue: list.filter((c) => c.due && c.due < today).length,
      oldestDays: items.length ? items[0].ageDays : null,
      oldest: items,
    });
  }
  return out;
}
