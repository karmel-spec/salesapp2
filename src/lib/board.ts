import { getLeads, type Lead, type TimelineEvent } from "./leads";
import { mailboxSummary, type MailboxSummary } from "./gmail";
import { taskSummaries, type TaskSummary } from "./taskboard";
import { replyTarget } from "./inbox-split";

/**
 * Team Inbox Board — every queue a customer can be waiting in, by the person
 * who owns it: their email inbox, their Store Map task board, and their
 * sales-console queues. One row per person; each cell answers the same three
 * questions (how many new, how many total, how old is the oldest).
 */

export interface BoardPerson {
  key: string;
  name: string;
  role: string;
  mailbox?: string; // Workspace address the service account can act as
  personalGmail?: boolean; // needs a one-time OAuth connect instead
  taskOwner?: string; // owner name as written on the Store Map board
  rep?: string; // sales-console rep name
  shared?: boolean;
}

export const BOARD_PEOPLE: BoardPerson[] = [
  { key: "brigham", name: "Brigham", role: "owner", mailbox: "brigham@brighamlarsonpianos.com", taskOwner: "Brigham Larson", rep: "Brigham" },
  { key: "melissa", name: "Melissa", role: "sales & events", mailbox: "melissa@brighamlarsonpianos.com", taskOwner: "Melissa Terry", rep: "Melissa" },
  { key: "karmel", name: "Karmel", role: "operations", mailbox: "karmel@brighamlarsonpianos.com", taskOwner: "Karmel Larson", rep: "Karmel" },
  { key: "alisa", name: "Alisa", role: "marketing", mailbox: "alisa@brighamlarsonpianos.com", rep: "Alisa" },
  { key: "lisa", name: "Lisa", role: "admin", mailbox: "lisa@brighamlarsonpianos.com", rep: "Lisa" },
  { key: "info", name: "Info", role: "shared inbox · info@", mailbox: "info@brighamlarsonpianos.com", shared: true },
  { key: "blp", name: "BLP Email", role: "brighamlarsonpianos@gmail.com", mailbox: "brighamlarsonpianos@gmail.com", personalGmail: true, shared: true },
  { key: "mark", name: "Mark", role: "shop lead", taskOwner: "Mark Hales" },
  { key: "matthew", name: "Matthew", role: "shop", taskOwner: "Matthew Wessman" },
  { key: "jacob", name: "Jacob", role: "shop", taskOwner: "Jacob Mower" },
  { key: "curtis", name: "Curtis", role: "shop", taskOwner: "Curtis Biggs" },
];

/** Backlog thresholds (days) for the amber / red signals. */
export const THRESHOLDS = { watch: 2, behind: 7 };

export type Status = "behind" | "watch" | "current" | "none";

export interface QueueItem {
  title: string;
  detail: string;
  ageDays: number;
  href?: string;
}

export interface QueueCell {
  kind: "email" | "tasks" | "console";
  new: number; // unread / open / awaiting
  total: number; // inbox threads / open cards / (replies + drafts)
  overdue?: number;
  askBrigham?: number; // tasks: cards in the "Questions for Brigham" column
  oldestDays: number | null;
  status: Status;
  label: string; // e.g. "140 new · 488 total"
  items: QueueItem[];
  note?: string; // "no mailbox", "connect this mailbox", an error
}

export interface BoardRow {
  key: string;
  name: string;
  role: string;
  shared?: boolean;
  email?: QueueCell;
  tasks?: QueueCell;
  console?: QueueCell;
  worst: Status;
  worstDays: number; // sort key: oldest waiting item across queues (-1 = nothing)
}

export interface Board {
  updatedAt: string;
  thresholds: typeof THRESHOLDS;
  rows: BoardRow[];
  totals: {
    emailUnread: number;
    emailTotal: number; // threads sitting in Inbox (not archived), all connected mailboxes
    openCards: number;
    consoleNew: number;
    behind: number;
    /** Per-person nav numbers: unread/total email on the left; on the right, open
     *  task cards split into everything else / "Questions for Brigham". */
    people: { key: string; name: string; emailUnread: number | null; emailTotal: number | null; cards: number | null; askBrigham: number | null }[];
  };
}

function statusFor(oldestDays: number | null, overdue = 0, hasAnything = true): Status {
  if (!hasAnything) return "none";
  if (overdue > 0) return "behind";
  if (oldestDays === null) return "current";
  if (oldestDays >= THRESHOLDS.behind) return "behind";
  if (oldestDays >= THRESHOLDS.watch) return "watch";
  return "current";
}

const worse = (a: Status, b: Status): Status => {
  const rank: Record<Status, number> = { none: 0, current: 1, watch: 2, behind: 3 };
  return rank[a] >= rank[b] ? a : b;
};

const ageDays = (iso: string) => Math.max(0, Math.round((Date.now() - (new Date(iso).getTime() || Date.now())) / 864e5));
const CLOSED = new Set(["won", "closed", "lost", "inactive", "unqualified"]);

function emailCell(m: MailboxSummary, person: BoardPerson): QueueCell {
  if (m.error) {
    return { kind: "email", new: 0, total: 0, oldestDays: null, status: "none", label: "—", items: [], note: person.personalGmail ? "connect this mailbox" : m.error };
  }
  return {
    kind: "email",
    new: m.unread,
    total: m.total,
    oldestDays: m.oldestDays,
    status: statusFor(m.oldestDays, 0, true),
    label: `${m.unread} new · ${m.total} in inbox`,
    items: m.oldest.map((o) => ({
      title: `${o.from} — ${o.subject}`,
      detail: "unread email",
      ageDays: o.ageDays,
      href: `https://mail.google.com/mail/u/?authuser=${encodeURIComponent(m.user)}#inbox/${o.id}`,
    })),
  };
}

function consoleCell(person: BoardPerson, leads: Lead[]): QueueCell | undefined {
  const items: QueueItem[] = [];
  let replies = 0;
  let drafts = 0;
  let oldest: number | null = null;
  const consider = (l: Lead, e: TimelineEvent, title: string, detail: string) => {
    const a = ageDays(e.at);
    if (oldest === null || a > oldest) oldest = a;
    items.push({ title, detail, ageDays: a, href: `/leads/${encodeURIComponent(l.id)}` });
  };
  for (const l of leads) {
    if (CLOSED.has(l.statusBucket)) continue;
    if (person.rep && l.effectiveRep === person.rep) drafts += l.drafts.filter((d) => d.status === "pending").length;
    for (const e of l.timeline) {
      if (e.kind !== "inbound" || e.archivedAt || e.readAt) continue;
      const target = replyTarget(l, e);
      const snippet = (e.text || "").replace(/^📥\s*/, "").replace(/\s+/g, " ").slice(0, 80);
      if (person.shared && person.key === "info" && !target) {
        replies++;
        consider(l, e, l.name, snippet);
      } else if (person.rep && target === person.rep) {
        replies++;
        consider(l, e, l.name, snippet);
      }
    }
  }
  if (!person.rep && !(person.shared && person.key === "info")) return undefined;
  items.sort((a, b) => b.ageDays - a.ageDays);
  const isInfo = person.key === "info";
  return {
    kind: "console",
    new: replies,
    total: replies + drafts,
    oldestDays: oldest,
    status: statusFor(oldest, 0, true),
    label: isInfo ? `${replies} new inquiries` : `${replies} replies · ${drafts} drafts`,
    items: items.slice(0, 5),
  };
}

let cache: { at: number; board: Board } | null = null;
const TTL_MS = 90_000;

export async function getBoard(force = false): Promise<Board> {
  if (!force && cache && Date.now() - cache.at < TTL_MS) return cache.board;

  const [{ leads }, tasks, mail] = await Promise.all([
    getLeads(false),
    taskSummaries().catch((): Map<string, TaskSummary> => new Map()),
    Promise.all(BOARD_PEOPLE.filter((p) => p.mailbox && !p.personalGmail).map((p) => mailboxSummary(p.mailbox!))),
  ]);
  const mailByUser = new Map(mail.map((m) => [m.user, m]));

  const rows: BoardRow[] = BOARD_PEOPLE.map((p) => {
    const row: BoardRow = { key: p.key, name: p.name, role: p.role, shared: p.shared, worst: "none", worstDays: -1 };
    if (p.mailbox) {
      const m = mailByUser.get(p.mailbox);
      row.email = m
        ? emailCell(m, p)
        : { kind: "email", new: 0, total: 0, oldestDays: null, status: "none", label: "—", items: [], note: p.personalGmail ? "connect this mailbox" : "not read" };
    }
    if (p.taskOwner) {
      const t = tasks.get(p.taskOwner.toLowerCase());
      row.tasks = t
        ? {
            kind: "tasks",
            new: t.open,
            total: t.open,
            overdue: t.overdue,
            askBrigham: t.askBrigham,
            oldestDays: t.oldestDays,
            status: statusFor(t.oldestDays, t.overdue, true),
            label: `${t.open} open · ${t.overdue} overdue`,
            items: t.oldest.map((c) => ({ title: c.title, detail: c.overdue ? `overdue · due ${c.due}` : c.due ? `due ${c.due}` : "task card", ageDays: c.ageDays, href: "https://blpstoremap.netlify.app" })),
          }
        : { kind: "tasks", new: 0, total: 0, overdue: 0, oldestDays: null, status: "current", label: "0 open", items: [] };
    }
    row.console = consoleCell(p, leads);
    for (const c of [row.email, row.tasks, row.console]) {
      if (!c || c.status === "none") continue;
      row.worst = worse(row.worst, c.status);
      const d = c.overdue ? Math.max(c.oldestDays ?? 0, THRESHOLDS.behind) : c.oldestDays ?? -1;
      if (d > row.worstDays) row.worstDays = d;
    }
    return row;
  });
  rows.sort((a, b) => b.worstDays - a.worstDays || b.name.localeCompare(a.name));

  const board: Board = {
    updatedAt: new Date().toISOString(),
    thresholds: THRESHOLDS,
    rows,
    totals: {
      emailUnread: rows.reduce((n, r) => n + (r.email?.new || 0), 0),
      emailTotal: rows.reduce((n, r) => n + (r.email?.total || 0), 0),
      openCards: rows.reduce((n, r) => n + (r.tasks?.new || 0), 0),
      consoleNew: rows.reduce((n, r) => n + (r.console?.new || 0), 0),
      behind: rows.filter((r) => r.worst === "behind").length,
      people: rows.map((r) => ({
        key: r.key,
        name: r.name,
        emailUnread: r.email && !r.email.note ? r.email.new : null,
        emailTotal: r.email && !r.email.note ? r.email.total : null,
        cards: r.tasks ? r.tasks.new : null,
        askBrigham: r.tasks ? r.tasks.askBrigham ?? 0 : null,
      })),
    },
  };
  cache = { at: Date.now(), board };
  return board;
}
