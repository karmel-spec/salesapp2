import { ensureTab, readTab, writeTab } from "./sheets";
import { expandRange, setDaysOff } from "./streak";

/** Days off (vacations) that never break a streak — "Streak Days Off" tab of the Leads Log: from, to, who, note, addedBy, addedAt. */
const TAB = "Streak Days Off";
const HEADER = ["from", "to", "who", "note", "addedBy", "addedAt"];
export interface DayOff { from: string; to: string; who: string; note: string; addedBy: string; addedAt: string }

export async function listDaysOff(): Promise<DayOff[]> {
  try {
    return (await readTab(TAB)).slice(1).filter((r) => r[0]).map((r) => ({ from: r[0], to: r[1] || r[0], who: r[2] || "Brigham", note: r[3] || "", addedBy: r[4] || "", addedAt: r[5] || "" }));
  } catch { return []; }
}
/** Load days off for one person into the streak math (call before computeStreak). */
export async function loadDaysOff(who: string): Promise<DayOff[]> {
  const all = await listDaysOff();
  const mine = all.filter((d) => !d.who || d.who.toLowerCase() === who.toLowerCase() || d.who.toLowerCase() === "everyone");
  setDaysOff(mine.flatMap((d) => expandRange(d.from, d.to)));
  return mine;
}
export async function addDayOff(d: Omit<DayOff, "addedAt">): Promise<void> {
  await ensureTab(TAB);
  const all = await listDaysOff();
  await writeTab(TAB, [HEADER, ...[...all, { ...d, addedAt: new Date().toISOString() }].map((x) => [x.from, x.to, x.who, x.note, x.addedBy, x.addedAt])]);
}
export async function removeDayOff(from: string, who: string): Promise<void> {
  const all = await listDaysOff();
  await writeTab(TAB, [HEADER, ...all.filter((x) => !(x.from === from && x.who.toLowerCase() === who.toLowerCase())).map((x) => [x.from, x.to, x.who, x.note, x.addedBy, x.addedAt])]);
}
