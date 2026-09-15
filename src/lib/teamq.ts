import { getStore } from "@netlify/blobs";
import { askBrighamCards } from "./taskboard";
import { dayKey, isBusinessDay } from "./streak";

/**
 * Team-questions streak for Brigham: the "Questions for Brigham" column on the
 * Store Map task boards (the second number on each Inbox Board post-it). A
 * question counts as answered the day its card leaves that column. We keep a
 * snapshot of open question ids in Netlify Blobs and diff it on every check.
 */
export interface TeamQuestions {
  open: number;
  byOwner: { owner: string; n: number; boardLink: string }[];
  answeredToday: number;
  streak: number; // consecutive business days with at least one question answered
  streakAlive: boolean;
  bestStreak: number;
  tracking: boolean; // false when the snapshot store isn't reachable (local dev)
}
interface State { ids: string[]; days: Record<string, number>; best?: number; updatedAt: string }

const boardLink = (owner: string) => `https://blpstoremap.netlify.app/#board=${encodeURIComponent(owner)}`;
const prevBusinessDay = (date: string) => { const dt = new Date(date + "T12:00:00Z"); do { dt.setUTCDate(dt.getUTCDate() - 1); } while (!isBusinessDay(dt.toISOString().slice(0, 10))); return dt.toISOString().slice(0, 10); };

export async function trackTeamQuestions(): Promise<TeamQuestions> {
  const cards = await askBrighamCards();
  const today = dayKey(new Date());
  const counts = new Map<string, number>();
  for (const c of cards) counts.set(c.owner || "Unassigned", (counts.get(c.owner || "Unassigned") || 0) + 1);
  const byOwner = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([owner, n]) => ({ owner, n, boardLink: boardLink(owner) }));
  let state: State | null = null;
  let tracking = true;
  let store: ReturnType<typeof getStore> | null = null;
  try {
    store = getStore({ name: "team-questions", consistency: "strong" });
    state = ((await store.get("state", { type: "json" })) as State | null) || null;
  } catch {
    tracking = false;
  }
  const currentIds = new Set(cards.map((c) => c.id));
  const days: Record<string, number> = state?.days || {};
  if (state) {
    const answered = state.ids.filter((id) => !currentIds.has(id)).length;
    if (answered) days[today] = (days[today] || 0) + answered;
  }
  // streak over business days ending today (or the last business day if today has none yet)
  let streak = 0;
  let cursor = isBusinessDay(today) ? today : prevBusinessDay(today);
  const alive = (days[today] || 0) > 0;
  if (!alive) cursor = prevBusinessDay(cursor);
  while ((days[cursor] || 0) > 0 && streak < 400) { streak++; cursor = prevBusinessDay(cursor); }
  const best = Math.max(state?.best || 0, streak);
  if (store && tracking) {
    try { await store.setJSON("state", { ids: [...currentIds], days, best, updatedAt: new Date().toISOString() } satisfies State); } catch { tracking = false; }
  }
  return { open: cards.length, byOwner, answeredToday: days[today] || 0, streak, streakAlive: alive, bestStreak: best, tracking };
}
