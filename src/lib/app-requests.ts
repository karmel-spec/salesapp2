import { ensureTab, readTab, writeTab } from "./sheets";

/**
 * Sales App 💡 requests (Brigham 10/30): bugs, edits and ideas filed from the
 * Sales App's own lightbulb stay IN the Sales App — one "Sales App Requests"
 * tab on the Leads Log workbook, managed from Dashboard → 💡 App Requests —
 * instead of going to the Store Map bridge's shared Requests list.
 *
 * Same shape and status flow as the Store Map's list so the team's habits
 * carry over: Requested → In progress → Live → Tested, plus the side
 * statuses (Texted for info, Resolved, Archived, Declined, Duplicate).
 */

const TAB = "Sales App Requests";
const HEADER = ["id", "at", "who", "email", "type", "text", "context", "screenshot", "status", "statusBy", "statusAt"];

export const REQUEST_STATUSES = [
  "Requested", "In progress", "Texted for info", "Live", "Tested", "Resolved", "Archived", "Declined", "Duplicate",
] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

/** Statuses that count as "done" — everything else is open work. */
export const CLOSED_STATUSES: readonly string[] = ["Live", "Tested", "Declined", "Duplicate", "Resolved", "Archived"];

export const REQUEST_TYPES = ["edit", "idea", "bug"] as const;

export interface AppRequest {
  id: string;
  at: string;
  who: string;
  email: string;
  type: string; // edit | idea | bug
  text: string;
  context: string;
  screenshot: string;
  status: string;
  statusBy: string;
  statusAt: string;
}

function fromRow(r: string[]): AppRequest {
  return {
    id: r[0] || "",
    at: r[1] || "",
    who: r[2] || "",
    email: r[3] || "",
    type: r[4] || "edit",
    text: r[5] || "",
    context: r[6] || "",
    screenshot: r[7] || "",
    status: r[8] || "Requested",
    statusBy: r[9] || "",
    statusAt: r[10] || "",
  };
}

function toRow(s: AppRequest): string[] {
  return [s.id, s.at, s.who, s.email, s.type, s.text, s.context, s.screenshot, s.status, s.statusBy, s.statusAt];
}

/** Newest first. */
export async function listRequests(): Promise<AppRequest[]> {
  const rows = await readTab(TAB);
  return rows.slice(1).map(fromRow).filter((s) => s.id).reverse();
}

/** Friendly id in the Store Map's style: MMDDYY + last name + that person's
 *  running request count, e.g. 103026larson01. */
function friendlyId(who: string, existing: AppRequest[]): string {
  const lastName = who.trim().split(/\s+/).pop()?.toLowerCase().replace(/[^a-z]/g, "") || "team";
  const n = existing.filter((r) => r.who.trim().toLowerCase() === who.trim().toLowerCase()).length + 1;
  const d = new Date();
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", month: "2-digit", day: "2-digit", year: "2-digit" })
    .formatToParts(d)
    .reduce<Record<string, string>>((acc, p) => ((acc[p.type] = p.value), acc), {});
  const base = `${parts.month}${parts.day}${parts.year}${lastName}`;
  let id = `${base}${String(n).padStart(2, "0")}`;
  let bump = n;
  while (existing.some((r) => r.id === id)) id = `${base}${String(++bump).padStart(2, "0")}`;
  return id;
}

export async function addRequest(input: {
  who: string;
  email?: string;
  type: string;
  text: string;
  context?: string;
  screenshot?: string;
}): Promise<AppRequest> {
  await ensureTab(TAB);
  const rows = await readTab(TAB);
  const all = rows.length ? rows : [HEADER];
  const existing = all.slice(1).map(fromRow).filter((s) => s.id);
  const who = input.who.trim().slice(0, 40) || "Unknown";
  const s: AppRequest = {
    id: friendlyId(who, existing),
    at: new Date().toISOString(),
    who,
    email: (input.email || "").trim().toLowerCase().slice(0, 80),
    type: (REQUEST_TYPES as readonly string[]).includes(input.type) ? input.type : "edit",
    text: input.text.trim().slice(0, 2000),
    context: (input.context || "").slice(0, 300),
    screenshot: input.screenshot || "",
    status: "Requested",
    statusBy: "",
    statusAt: "",
  };
  all.push(toRow(s));
  await writeTab(TAB, all);
  return s;
}

/** Returns the updated request (and whether it just went Live) or null when the id is unknown. */
export async function setRequestStatus(
  id: string,
  status: string,
  by: string
): Promise<{ request: AppRequest; wentLive: boolean } | null> {
  if (!(REQUEST_STATUSES as readonly string[]).includes(status)) throw new Error("bad status");
  const rows = await readTab(TAB);
  const i = rows.findIndex((r, n) => n > 0 && (r[0] || "") === id);
  if (i < 0) return null;
  while (rows[i].length < HEADER.length) rows[i].push("");
  const wasLive = rows[i][8] === "Live";
  rows[i][8] = status;
  rows[i][9] = by.slice(0, 40);
  rows[i][10] = new Date().toISOString();
  await writeTab(TAB, rows);
  return { request: fromRow(rows[i]), wentLive: status === "Live" && !wasLive };
}
