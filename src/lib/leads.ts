import crypto from "crypto";
import { config } from "./config";
import { readRows, writeCells, appendRow, canWrite, expandColumns } from "./sheets";

/**
 * Lead domain model over the Leads Log spreadsheet.
 *
 * The sheet is the source of truth. Column positions are discovered from the
 * header row each read (so inserting columns in the sheet won't corrupt
 * writes), rows are normalized into Lead objects, and every write targets
 * specific cells of a specific row.
 */

export const COLS = {
  status: "Outcome/Status (+ reason)",
  dateAdded: "Date Added",
  lastContact: "Date of Last Contact",
  rep: "Sales Rep OPEN / WORKING / CLOSE",
  headline: "Headline",
  score: "1-10",
  firstName: "Customer FIRST Name",
  lastName: "Customer LAST Name",
  activityTimeline: "Activity Timeline",
  notes: "Notes",
  phone: "Customer Phone Number",
  email: "Customer Email",
  social: "Customer Social Media Handle",
  source: "Source of Business?",
  inquiryMethod: "Inquiry Method",
  leadType: "Type of Lead",
  pianoType: "Type of Piano",
  value: "$ Value",
  alertSent: "(New Lead Alert) text to Brigham",
  capturedBy: "Lead Capture/Entry (Admin Name)",
  blpId: "blp_id",
  appActivity: "App Activity",
  timelineJson: "timeline_data_json",
  arnoldDraftJson: "arnold_draft_json",
} as const;

export type StatusBucket = "new" | "active" | "snoozed" | "won" | "lost" | "inactive" | "support";

export interface DraftMessage {
  channel: "sms" | "email";
  subject?: string;
  body: string;
  note?: string; // Arnold's one-line reasoning, shown to the rep
  status: "pending" | "approved" | "sent" | "dismissed";
  createdAt: string;
  createdBy: string; // "arnold" | "arnold-api" | rep name
  sentAt?: string;
}

export interface TimelineEvent {
  at: string; // ISO timestamp
  who: string;
  kind: string; // note | sms_out | email_out | call | status | assign | draft
  text: string;
}

export interface Lead {
  id: string; // blp_id if present, else "row-<n>"
  row: number; // 1-based sheet row (write target)
  status: string;
  statusBucket: StatusBucket;
  dateAdded: string;
  lastContact: string; // best-known last contact date (raw string)
  lastTouchISO: string | null; // resolved last-touch date used by stale rule
  daysSinceContact: number | null;
  isStale: boolean; // no contact in >= staleDays and still open
  snoozeUntil: string | null; // raw date parsed from a "Snoozed until …" status
  snoozeWoke: boolean; // snooze date has passed — lead is treated as active again
  rep: string; // normalized: Brigham | Karmel | Sally | Melissa | Arnold | other raw
  repRaw: string;
  effectiveRep: string; // rep after stale rule (stale open leads → Arnold)
  headline: string;
  score: string;
  firstName: string;
  lastName: string;
  name: string;
  activityTimeline: string;
  notes: string;
  phone: string; // raw cell (may contain commentary)
  phoneDialable: string; // best-effort E.164-ish extraction
  email: string;
  emailClean: string;
  social: string;
  source: string;
  inquiryMethod: string;
  leadType: string;
  pianoType: string;
  value: string;
  capturedBy: string;
  appActivity: string;
  timeline: TimelineEvent[];
  drafts: DraftMessage[];
}

export interface SheetShape {
  header: string[];
  col: Record<keyof typeof COLS, number>; // -1 if column missing
}

function normStatus(raw: string): StatusBucket {
  const s = raw.trim().toLowerCase();
  if (!s) return "new";
  if (s.startsWith("won")) return "won";
  if (s.startsWith("lost")) return "lost";
  if (s.includes("support")) return "support";
  if (s.startsWith("active")) return "active"; // e.g. "Active (snooze ended)"
  if (s.includes("snooze")) return "snoozed";
  if (s.includes("inactive") || s.includes("past 30")) return "inactive";
  if (s.includes("active") || s.includes("working") || s.includes("open")) return "active";
  return "active";
}

export function normRep(raw: string): string {
  const s = raw.trim().toLowerCase().replace(/\s+/g, " ");
  if (!s) return "";
  if (s.includes("brigham") || /\bbl\b/.test(s)) return "Brigham";
  if (s.includes("karmel")) return "Karmel";
  if (s.includes("sally")) return "Arnold"; // Sally retired; Arnold inherited her leads
  if (s.includes("melissa")) return "Melissa";
  if (s.includes("alisa")) return "Alisa";
  if (s.includes("arnold")) return "Arnold";
  // Anything that doesn't look like a short person name (notes, dates,
  // "O:/W:/C:" scribbles) is treated as unassigned rather than a rep.
  if (/[\d:@/]/.test(s) || s.split(" ").length > 3 || s.length > 24) return "";
  return s.replace(/(^|\s)\w/g, (c) => c.toUpperCase());
}

const MONTHS = ["january","february","march","april","may","june","july","august","september","october","november","december"];
const SEASONS: Record<string, [number, number]> = {
  spring: [2, 20], summer: [5, 21], fall: [8, 22], autumn: [8, 22], winter: [11, 21],
};

/**
 * Parse the wake date out of a snooze status. Handles the formats reps
 * actually write: "12/1/26", "1/2027", "October 1, 2026", "May 2027",
 * "summer of 2027", "fall?" (no year → next occurrence).
 */
export function parseSnoozeDate(raw: string, now: Date): Date | null {
  const s = raw.toLowerCase();
  let m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (m) {
    const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return new Date(year, Number(m[1]) - 1, Number(m[2]));
  }
  m = s.match(/(\d{1,2})\/(\d{4})/);
  if (m) return new Date(Number(m[2]), Number(m[1]) - 1, 1);
  // (?!\d) keeps the day capture from swallowing the first digits of a year.
  m = s.match(new RegExp(`(${MONTHS.join("|")})\\s*(\\d{1,2}(?!\\d))?(?:,)?\\s*(\\d{4})?`));
  if (m) {
    const month = MONTHS.indexOf(m[1]);
    const day = m[2] ? Number(m[2]) : 1;
    let year = m[3] ? Number(m[3]) : now.getFullYear();
    if (!m[3] && new Date(year, month, day) <= now) year += 1;
    return new Date(year, month, day);
  }
  m = s.match(/(spring|summer|fall|autumn|winter)\s*(?:of\s*)?(\d{4})?/);
  if (m) {
    const [month, day] = SEASONS[m[1]];
    let year = m[2] ? Number(m[2]) : now.getFullYear();
    if (!m[2] && new Date(year, month, day) <= now) year += 1;
    return new Date(year, month, day);
  }
  return null;
}

function parseUSDate(raw: string): Date | null {
  const m = raw.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (!m) return null;
  const [, mo, d, y] = m;
  const year = y.length === 2 ? 2000 + Number(y) : Number(y);
  const dt = new Date(year, Number(mo) - 1, Number(d));
  return isNaN(dt.getTime()) ? null : dt;
}

function extractPhone(raw: string): string {
  const m = raw.replace(/\D+/g, " ").match(/\b1?(\d{3})\s*(\d{3})\s*(\d{4})\b/);
  return m ? `+1${m[1]}${m[2]}${m[3]}` : "";
}

function extractEmail(raw: string): string {
  const m = raw.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
  return m ? m[0].replace(/\.+$/, "") : "";
}

function safeJson<T>(raw: string, fallback: T): T {
  if (!raw || !raw.trim()) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/**
 * Timeline entries written by the old sales console used
 * {date, type, text, direction} — normalize everything to {at, who, kind, text}.
 */
function normalizeTimeline(raw: unknown[]): TimelineEvent[] {
  return raw
    .map((entry) => {
      const e = (entry ?? {}) as Record<string, unknown>;
      if (typeof e.at === "string" && typeof e.kind === "string") {
        return { at: e.at, who: String(e.who ?? "team"), kind: e.kind, text: String(e.text ?? "") };
      }
      const at = typeof e.at === "string" ? e.at : typeof e.date === "string" ? e.date : "";
      const type = String(e.type ?? e.kind ?? "note").toLowerCase();
      const inbound = e.direction === "inbound";
      const kind = inbound
        ? "inbound"
        : type === "text" || type === "sms"
          ? "sms_out"
          : type === "email"
            ? "email_out"
            : type;
      return { at, who: String(e.who ?? (inbound ? "customer" : "team")), kind, text: String(e.text ?? "") };
    })
    .filter((e) => e.text || e.at);
}

export function shapeFromHeader(header: string[]): SheetShape {
  const col = {} as SheetShape["col"];
  const lower = header.map((h) => h.trim().toLowerCase());
  for (const key of Object.keys(COLS) as (keyof typeof COLS)[]) {
    col[key] = lower.indexOf(COLS[key].toLowerCase());
  }
  return { header, col };
}

function rowToLead(row: string[], rowNumber: number, shape: SheetShape, now: Date): Lead {
  const get = (k: keyof typeof COLS) => {
    const i = shape.col[k];
    return i >= 0 && i < row.length ? (row[i] ?? "").toString() : "";
  };

  const statusRaw = get("status");
  let bucket = normStatus(statusRaw);
  // Snooze: "Snoozed until 1/15/2027" sleeps the lead; past the date it wakes.
  let snoozeUntil: string | null = null;
  let snoozeWoke = false;
  if (bucket === "snoozed") {
    const until = parseSnoozeDate(statusRaw, now);
    snoozeUntil = until ? until.toLocaleDateString("en-US") : null;
    // Only a PAST parseable date wakes the lead; an unparseable snooze
    // sleeps indefinitely rather than being kicked awake.
    if (until && until <= now) {
      snoozeWoke = true;
      bucket = "active"; // wakes: back in the open pipeline (and the stale rule)
    }
  }
  const repRaw = get("rep");
  const rep = normRep(repRaw);
  const dateAdded = get("dateAdded");
  const lastContact = get("lastContact");

  const timeline = normalizeTimeline(safeJson<unknown[]>(get("timelineJson"), []));
  // Last touch = explicit last-contact date, else newest CONTACT event, else
  // date added. Drafts, notes, edits, and assignments are app housekeeping —
  // they must not reset the stale clock (or Arnold drafting a lead would
  // un-assign it from himself).
  const CONTACT_KINDS = ["sms_out", "email_out", "call", "inbound", "meeting", "visit"];
  const timelineDates = timeline
    .filter((e) => CONTACT_KINDS.includes(e.kind))
    .map((e) => new Date(e.at))
    .filter((d) => !isNaN(d.getTime()));
  const candidates = [
    parseUSDate(lastContact),
    ...timelineDates,
    parseUSDate(dateAdded),
  ].filter(Boolean) as Date[];
  const lastTouch = candidates.length
    ? new Date(Math.max(...candidates.map((d) => d.getTime())))
    : null;
  const daysSince = lastTouch
    ? Math.floor((now.getTime() - lastTouch.getTime()) / 86400000)
    : null;

  const openBucket = bucket === "new" || bucket === "active";
  const phoneDialable = extractPhone(get("phone"));
  const emailClean = extractEmail(get("email"));
  // Arnold works leads by text/email — a lead with neither stays with its
  // human rep (e.g. social-media-only leads assigned to Alisa).
  const arnoldReachable = Boolean(phoneDialable || emailClean);
  const isStale = openBucket && daysSince !== null && daysSince >= config.staleDays && arnoldReachable;

  const first = get("firstName").trim();
  const last = get("lastName").trim();
  const blpId = get("blpId").trim();

  return {
    id: blpId || `row-${rowNumber}`,
    row: rowNumber,
    status: statusRaw.trim(),
    statusBucket: bucket,
    dateAdded,
    lastContact,
    lastTouchISO: lastTouch ? lastTouch.toISOString() : null,
    daysSinceContact: daysSince,
    isStale,
    snoozeUntil,
    snoozeWoke,
    rep,
    repRaw,
    // A deliberately assigned rep always wins (manual reassignment sticks).
    // The stale rule claims only unassigned stale leads for display; the
    // sweep is what persists Arnold onto stale leads' sheet rows.
    effectiveRep: rep || (isStale ? config.staleRep : openBucket ? config.defaultRep : ""),
    headline: get("headline").trim(),
    score: get("score").trim(),
    firstName: first,
    lastName: last,
    name: [first, last].filter(Boolean).join(" ") || "(no name)",
    activityTimeline: get("activityTimeline"),
    notes: get("notes"),
    phone: get("phone"),
    phoneDialable,
    email: get("email"),
    emailClean,
    social: get("social").trim(),
    source: get("source").trim(),
    inquiryMethod: get("inquiryMethod").trim(),
    leadType: get("leadType").trim(),
    pianoType: get("pianoType").trim(),
    value: get("value").trim(),
    capturedBy: get("capturedBy").trim(),
    appActivity: get("appActivity"),
    timeline,
    drafts: safeJson<DraftMessage[]>(get("arnoldDraftJson"), []),
  };
}

let cache: { leads: Lead[]; shape: SheetShape; at: number } | null = null;
const CACHE_MS = 20_000;

export async function getLeads(force = false): Promise<{ leads: Lead[]; shape: SheetShape }> {
  if (!force && cache && Date.now() - cache.at < CACHE_MS) return cache;
  const rows = await readRows();
  if (!rows.length) throw new Error("Leads Log sheet is empty");
  const shape = shapeFromHeader(rows[0]);
  const now = new Date();
  const leads: Lead[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    // Skip empty rows — including "ghost" rows whose only content is an
    // auto-filled checkbox value (TRUE/FALSE) from the alert column.
    if (!row.some((c) => c && c.trim() && !["TRUE", "FALSE"].includes(c.trim().toUpperCase()))) continue;
    leads.push(rowToLead(row, i + 1, shape, now));
  }
  cache = { leads, shape, at: Date.now() };
  return cache;
}

export function invalidateCache() {
  cache = null;
}

export async function getLead(id: string): Promise<{ lead: Lead; shape: SheetShape } | null> {
  const { leads, shape } = await getLeads();
  const lead = leads.find((l) => l.id === id);
  return lead ? { lead, shape } : null;
}

function requireCol(shape: SheetShape, key: keyof typeof COLS): number {
  const i = shape.col[key];
  if (i < 0) throw new Error(`Column "${COLS[key]}" not found in the Leads Log header`);
  return i;
}

/** Update simple fields on a lead's sheet row. */
export async function updateLeadFields(
  lead: Lead,
  shape: SheetShape,
  fields: Partial<Record<keyof typeof COLS, string>>
): Promise<void> {
  const cells = Object.entries(fields).map(([k, value]) => ({
    row: lead.row,
    col: requireCol(shape, k as keyof typeof COLS),
    value: value ?? "",
  }));
  if (cells.length) await writeCells(cells);
  invalidateCache();
}

const AUTO_COLS: (keyof typeof COLS)[] = ["blpId", "appActivity", "timelineJson", "arnoldDraftJson"];

/**
 * The hidden app columns may not exist yet in a fresh sheet; add any missing
 * ones to the end of the header row (requires write access).
 */
export async function ensureAppColumns(shape: SheetShape): Promise<SheetShape> {
  const missing = AUTO_COLS.filter((k) => shape.col[k] < 0);
  if (!missing.length || !canWrite()) return shape;
  let next = shape.header.length;
  const cells = missing.map((k) => ({ row: 1, col: next++, value: COLS[k] }));
  await expandColumns(next);
  await writeCells(cells);
  invalidateCache();
  const { shape: fresh } = await getLeads(true);
  return fresh;
}

/** Append a timeline event: structured JSON + readable App Activity line. */
export async function appendTimeline(
  lead: Lead,
  shape: SheetShape,
  event: TimelineEvent,
  opts: { touchLastContact?: boolean } = {}
): Promise<void> {
  const s = await ensureAppColumns(shape);
  const timeline = [...lead.timeline, event];
  const stamp = new Date(event.at);
  const line = `[${stamp.toLocaleDateString("en-US")} ${event.who} · ${event.kind}] ${event.text}`;
  const fields: Partial<Record<keyof typeof COLS, string>> = {
    timelineJson: JSON.stringify(timeline),
    appActivity: lead.appActivity ? `${lead.appActivity}\n${line}` : line,
  };
  if (opts.touchLastContact) {
    fields.lastContact = stamp.toLocaleDateString("en-US");
  }
  await updateLeadFields(lead, s, fields);
}

/** Replace the lead's draft list (Arnold suggestions + approval state). */
export async function saveDrafts(lead: Lead, shape: SheetShape, drafts: DraftMessage[]): Promise<void> {
  const s = await ensureAppColumns(shape);
  await updateLeadFields(lead, s, { arnoldDraftJson: JSON.stringify(drafts) });
}

/** Create a new lead row. Defaults rep to Brigham per business rule. */
export async function createLead(input: {
  firstName: string;
  lastName?: string;
  headline?: string;
  phone?: string;
  email?: string;
  notes?: string;
  source?: string;
  inquiryMethod?: string;
  leadType?: string;
  pianoType?: string;
  value?: string;
  capturedBy?: string;
}): Promise<string> {
  const { leads, shape } = await getLeads(true);

  // Dedupe guard: same phone or email on an existing lead.
  const phone = extractPhone(input.phone || "");
  const email = extractEmail(input.email || "");
  const dupe = leads.find(
    (l) => (phone && l.phoneDialable === phone) || (email && l.emailClean.toLowerCase() === email.toLowerCase())
  );
  if (dupe) throw new Error(`Possible duplicate of existing lead "${dupe.name}" (${dupe.id})`);

  const s = await ensureAppColumns(shape);
  const width = Math.max(s.header.length, ...Object.values(s.col).map((i) => i + 1));
  const row = new Array(width).fill("");
  const set = (k: keyof typeof COLS, v: string) => {
    if (s.col[k] >= 0) row[s.col[k]] = v;
  };
  const id = `blp-${crypto.randomBytes(5).toString("hex")}`;
  const today = new Date().toLocaleDateString("en-US");
  set("blpId", id);
  set("dateAdded", today);
  set("rep", config.defaultRep);
  set("status", "Active");
  set("firstName", input.firstName);
  set("lastName", input.lastName || "");
  set("headline", input.headline || "");
  set("phone", input.phone || "");
  set("email", input.email || "");
  set("notes", input.notes || "");
  set("source", input.source || "");
  set("inquiryMethod", input.inquiryMethod || "");
  set("leadType", input.leadType || "");
  set("pianoType", input.pianoType || "");
  set("value", input.value || "");
  set("capturedBy", input.capturedBy || "");
  set(
    "timelineJson",
    JSON.stringify([
      {
        at: new Date().toISOString(),
        who: input.capturedBy || "app",
        kind: "created",
        text: `Lead created in sales app, assigned to ${config.defaultRep}`,
      } satisfies TimelineEvent,
    ])
  );
  await appendRow(row);
  invalidateCache();
  return id;
}

/**
 * Cells for appending a timeline event WITHOUT writing (so sweeps can batch
 * many leads into one API call — Sheets allows only 60 writes/min/user).
 */
function timelineCells(lead: Lead, shape: SheetShape, event: TimelineEvent): { row: number; col: number; value: string }[] {
  const cells: { row: number; col: number; value: string }[] = [];
  const stamp = new Date(event.at);
  const line = `[${stamp.toLocaleDateString("en-US")} ${event.who} · ${event.kind}] ${event.text}`;
  if (shape.col.timelineJson >= 0) {
    cells.push({ row: lead.row, col: shape.col.timelineJson, value: JSON.stringify([...lead.timeline, event]) });
  }
  if (shape.col.appActivity >= 0) {
    cells.push({
      row: lead.row,
      col: shape.col.appActivity,
      value: lead.appActivity ? `${lead.appActivity}\n${line}` : line,
    });
  }
  return cells;
}

/**
 * Wake sweep: leads whose snooze date has passed get their sheet status
 * flipped back to Active so the sheet matches what the app shows.
 * Single batched write for any number of leads.
 */
export async function wakeExpiredSnoozes(): Promise<Lead[]> {
  const { leads, shape: rawShape } = await getLeads(true);
  const targets = leads.filter((l) => l.snoozeWoke);
  if (!targets.length) return [];
  const shape = await ensureAppColumns(rawShape);
  const statusCol = requireCol(shape, "status");
  const cells = targets.flatMap((l) => [
    { row: l.row, col: statusCol, value: `Active (snooze ended${l.snoozeUntil ? " " + l.snoozeUntil : ""})` },
    ...timelineCells(l, shape, {
      at: new Date().toISOString(),
      who: "app",
      kind: "assign",
      text: `⏰ Snooze ended${l.snoozeUntil ? ` (${l.snoozeUntil})` : ""} — lead is active again`,
    }),
  ]);
  await writeCells(cells);
  invalidateCache();
  return targets;
}

/**
 * Stale sweep: persist the 30-day rule back to the sheet — any open lead
 * with no contact in >= staleDays gets reassigned to Arnold in the rep column.
 * Returns the leads that were reassigned.
 */
export async function applyStaleAssignments(): Promise<Lead[]> {
  const { leads, shape: rawShape } = await getLeads(true);
  const targets = leads.filter((l) => l.isStale && l.rep !== config.staleRep);
  if (!targets.length) return [];
  const shape = await ensureAppColumns(rawShape);
  const repCol = requireCol(shape, "rep");
  // One batched write for the entire sweep — per-lead writes blow through
  // the Sheets 60-writes/minute quota with a hundred stale leads.
  const cells = targets.flatMap((l) => [
    { row: l.row, col: repCol, value: config.staleRep },
    ...timelineCells(l, shape, {
      at: new Date().toISOString(),
      who: "app",
      kind: "assign",
      text: `Auto-reassigned to ${config.staleRep} (${l.daysSinceContact}d since last contact, was "${l.repRaw || "unassigned"}")`,
    }),
  ]);
  await writeCells(cells);
  invalidateCache();
  return targets;
}
