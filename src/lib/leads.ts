import crypto from "crypto";
import { config } from "./config";
import { readRows, writeCells, insertRowTop, canWrite, expandColumns, readCell, moveRow } from "./sheets";

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
  subRep: "Sub Rep (assistant)",
  openedBy: "Lead Opened By (Rep)",
  closedBy: "Sale Closed By (Rep)",
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

export type StatusBucket = "new" | "active" | "snoozed" | "won" | "lost" | "inactive" | "support" | "unqualified" | "closed";

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
  editedBy?: string; // audit trail when a rep edits an entry after the fact
  editedAt?: string;
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
  isStale: boolean; // quiet past its threshold and still open (see staleRule)
  /** Which staleness rule applies: never-contacted leads go to Arnold after
   *  newLeadStaleDays (10); worked leads after staleDays (30) of quiet. */
  staleRule: "new-10d" | "worked-30d";
  snoozeUntil: string | null; // raw date parsed from a "Snoozed until …" status
  snoozeWoke: boolean; // snooze date has passed — lead is treated as active again
  rep: string; // normalized: Brigham | Karmel | Sally | Melissa | Arnold | other raw
  repRaw: string;
  /** Assistant rep working the lead WITH the primary (e.g. Brigham owns it,
   *  Arnold handles follow-up tasks). Never overwritten by the stale sweep. */
  subRep: string;
  effectiveRep: string; // primary owner (defaults to Brigham for open leads)
  /** Sub-rep after the stale rule: quiet leads get Arnold as HELPER (the
   *  primary keeps the lead). */
  effectiveSubRep: string;
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
  openedBy: string;
  closedBy: string;
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
  if (s.includes("unqualified") || s.includes("not a lead")) return "unqualified";
  if (s.startsWith("closed") || s === "resolved") return "closed";
  if (s.includes("support")) return "support";
  if (s.startsWith("new")) return "new";
  if (s.startsWith("active")) return "active"; // e.g. "Active (snooze ended)"
  if (s.includes("snooze")) return "snoozed";
  if (s.includes("inactive") || s.includes("past 30")) return "inactive";
  if (s.includes("active") || s.includes("working") || s.includes("open")) return "active";
  return "active";
}

/** Parse the reason out of a "LOST - reason" / "LOST: reason" status. */
export function lostReason(raw: string): string {
  const m = raw.trim().match(/^lost\??\s*[-–:]\s*(.+)$/i);
  return m ? m[1].trim() : "";
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
        return {
          at: e.at,
          who: String(e.who ?? "team"),
          kind: e.kind,
          text: String(e.text ?? ""),
          ...(typeof e.editedBy === "string" ? { editedBy: e.editedBy } : {}),
          ...(typeof e.editedAt === "string" ? { editedAt: e.editedAt } : {}),
        };
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
  // "New" covers a lead's first 7 days; after that it flows into Active.
  // A lead with no parseable Date Added can't age out, so it's treated as
  // Active immediately (blank-status rows are old imports, not fresh leads).
  if (bucket === "new") {
    const added = parseUSDate(get("dateAdded"));
    if (!added || (now.getTime() - added.getTime()) / 86400000 > 7) bucket = "active";
  }
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
  // Two-tier staleness: a lead that has never been contacted (its only touch
  // is the inquiry itself) goes to Arnold after newLeadStaleDays (10); a lead
  // someone has actually worked goes to Arnold after staleDays (30) of quiet.
  const everContacted = Boolean(parseUSDate(lastContact) || timelineDates.length);
  const staleRule: "new-10d" | "worked-30d" = everContacted ? "worked-30d" : "new-10d";
  const threshold = everContacted ? config.staleDays : config.newLeadStaleDays;
  const isStale = openBucket && daysSince !== null && daysSince >= threshold && arnoldReachable;

  const subRepNorm = normRep(get("subRep"));
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
    staleRule,
    snoozeUntil,
    snoozeWoke,
    rep,
    repRaw,
    subRep: subRepNorm,
    // The primary owner is never displaced by the stale rule (2026-07-09):
    // quiet leads get Arnold as SUB-REP instead, and the owner keeps the lead.
    effectiveRep: rep || (openBucket ? config.defaultRep : ""),
    effectiveSubRep: subRepNorm || (isStale && rep !== config.staleRep ? config.staleRep : ""),
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
    openedBy: normRep(get("openedBy")),
    closedBy: normRep(get("closedBy")),
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
    const lead = rowToLead(row, i + 1, shape, now);
    // Section-label rows humans type into the sheet ("ACTIVE SHOP LEADS",
    // "Player Rebuild") are headings, not leads: no name and no way to
    // contact anyone. (Some carry a stamped blp_id from the backfill —
    // identity fields, not ids, decide what counts as a lead.)
    if (!lead.name.replace("(no name)", "").trim() && !lead.phone.trim() && !lead.email.trim() && !lead.social.trim()) {
      continue;
    }
    leads.push(lead);
  }
  cache = { leads, shape, at: Date.now() };
  return cache;
}

export function invalidateCache() {
  cache = null;
}

export async function getLead(id: string, force = false): Promise<{ lead: Lead; shape: SheetShape } | null> {
  const { leads, shape } = await getLeads(force);
  const lead = leads.find((l) => l.id === id);
  return lead ? { lead, shape } : null;
}

function requireCol(shape: SheetShape, key: keyof typeof COLS): number {
  const i = shape.col[key];
  if (i < 0) throw new Error(`Column "${COLS[key]}" not found in the Leads Log header`);
  return i;
}

/**
 * Rows shift when leads are inserted at the top, so before writing we verify
 * the target row still belongs to this lead (via its blp_id cell). On a
 * mismatch we re-locate the lead by id and write there instead.
 */
async function ensureRowCurrent(lead: Lead, shape: SheetShape): Promise<Lead> {
  if (shape.col.blpId < 0 || !lead.id || lead.id.startsWith("row-")) return lead;
  const cell = (await readCell(lead.row, shape.col.blpId)).trim();
  if (cell === lead.id) return lead;
  invalidateCache();
  const { leads } = await getLeads(true);
  const fresh = leads.find((l) => l.id === lead.id);
  if (!fresh) throw new Error(`Lead ${lead.id} moved and could not be re-located — refresh and retry`);
  return fresh;
}

/** Update simple fields on a lead's sheet row. */
export async function updateLeadFields(
  lead: Lead,
  shape: SheetShape,
  fields: Partial<Record<keyof typeof COLS, string>>
): Promise<void> {
  // Auto-create any app-managed columns being written (e.g. "Sub Rep").
  if (Object.keys(fields).some((k) => shape.col[k as keyof typeof COLS] < 0)) {
    shape = await ensureAppColumns(shape);
  }
  const target = await ensureRowCurrent(lead, shape);
  const cells = Object.entries(fields).map(([k, value]) => ({
    row: target.row,
    col: requireCol(shape, k as keyof typeof COLS),
    value: value ?? "",
  }));
  if (cells.length) await writeCells(cells);
  invalidateCache();
}

const AUTO_COLS: (keyof typeof COLS)[] = ["blpId", "appActivity", "timelineJson", "arnoldDraftJson", "subRep", "openedBy", "closedBy"];

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
  // Pretty-printed so the sheet column reads like structured text while
  // remaining valid JSON for the app to parse back.
  await updateLeadFields(lead, s, { arnoldDraftJson: JSON.stringify(drafts, null, 2) });
}

/** Create a new lead row. Defaults rep to Brigham per business rule. */
export async function createLead(input: {
  firstName: string;
  lastName?: string;
  headline?: string;
  phone?: string;
  email?: string;
  social?: string;
  notes?: string;
  source?: string;
  inquiryMethod?: string;
  leadType?: string;
  pianoType?: string;
  value?: string;
  score?: string;
  capturedBy?: string;
  openedBy?: string;
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
  const opener = input.openedBy?.trim() || config.defaultRep;
  set("blpId", id);
  set("dateAdded", today);
  set("rep", opener);
  set("openedBy", opener);
  set("status", "Active");
  set("firstName", input.firstName);
  set("lastName", input.lastName || "");
  set("headline", input.headline || "");
  set("phone", input.phone || "");
  set("email", input.email || "");
  set("social", input.social || "");
  set("notes", input.notes || "");
  set("source", input.source || "");
  set("inquiryMethod", input.inquiryMethod || "");
  set("leadType", input.leadType || "");
  set("pianoType", input.pianoType || "");
  set("value", input.value || "");
  set("score", input.score || "");
  set("capturedBy", input.capturedBy || "");
  set(
    "timelineJson",
    JSON.stringify([
      {
        at: new Date().toISOString(),
        who: input.capturedBy || "app",
        kind: "created",
        text: `Lead created in sales app, opened by ${opener}`,
      } satisfies TimelineEvent,
    ])
  );
  // New leads go to the TOP of the sheet (row 2), keeping the working area
  // newest-first and the WON/LOST/SNOOZED sections undisturbed at the bottom.
  await insertRowTop(row);
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
 * Stale sweep: persist the quiet-lead rules back to the sheet. Never-contacted
 * leads after newLeadStaleDays (10) and worked leads after staleDays (30) of
 * quiet get Arnold added as SUB-REP — the primary rep keeps the lead.
 * Returns the leads Arnold joined.
 */
export async function applyStaleAssignments(): Promise<Lead[]> {
  const { leads, shape: rawShape } = await getLeads(true);
  // Skip leads Arnold already owns or already assists.
  const targets = leads.filter((l) => l.isStale && l.rep !== config.staleRep && l.subRep !== config.staleRep);
  if (!targets.length) return [];
  const shape = await ensureAppColumns(rawShape);
  const subRepCol = requireCol(shape, "subRep");
  // One batched write for the entire sweep — per-lead writes blow through
  // the Sheets 60-writes/minute quota with a hundred stale leads.
  const cells = targets.flatMap((l) => [
    { row: l.row, col: subRepCol, value: config.staleRep },
    ...timelineCells(l, shape, {
      at: new Date().toISOString(),
      who: "app",
      kind: "assign",
      text: `${config.staleRep} added as sub-rep (${l.daysSinceContact}d quiet — ${
        l.staleRule === "new-10d" ? `new lead never contacted, ${config.newLeadStaleDays}-day rule` : `worked lead, ${config.staleDays}-day rule`
      }); ${l.effectiveRep || "the primary rep"} keeps the lead`,
    }),
  ]);
  await writeCells(cells);
  invalidateCache();
  return targets;
}

/**
 * Tidy the sheet: re-file rows whose status closed after the last
 * organization. The bottom of the sheet holds three sections in order —
 * SNOOZED, then WON, then LOST — and any snoozed/won/lost row still sitting
 * in the working area above gets moved down to the top of its section.
 * Runs nightly (with the backup) and from the dashboard.
 */
export async function tidySheetSections(): Promise<{ moved: { name: string; bucket: StatusBucket }[] }> {
  const SECTION: StatusBucket[] = ["snoozed", "won", "lost"]; // top → bottom
  const moved: { name: string; bucket: StatusBucket }[] = [];

  for (let pass = 0; pass < 40; pass++) {
    const { leads } = await getLeads(true);
    const byRow = [...leads].sort((a, b) => a.row - b.row);
    if (!byRow.length) break;

    // Detect the contiguous tail blocks: LOST suffix, WON above it, SNOOZED above that.
    let i = byRow.length;
    const blockStart: Partial<Record<StatusBucket, number>> = {};
    for (const bucket of [...SECTION].reverse()) {
      let start = i;
      while (start > 0 && byRow[start - 1].statusBucket === bucket) start--;
      if (start < i) blockStart[bucket] = byRow[start].row;
      i = start;
    }
    const bottom = byRow[byRow.length - 1].row + 1;
    // Destination for each section: top of its block, else where the next
    // section below begins, else the very bottom.
    const dest: Record<StatusBucket, number> = {} as Record<StatusBucket, number>;
    let fallback = bottom;
    for (const bucket of [...SECTION].reverse()) {
      dest[bucket] = blockStart[bucket] ?? fallback;
      fallback = dest[bucket];
    }

    // Working area = rows above the first section block.
    const firstSectionRow = Math.min(...SECTION.map((b) => blockStart[b] ?? bottom));
    const misplaced = byRow.find((l) => l.row < firstSectionRow && SECTION.includes(l.statusBucket));
    if (!misplaced) break;

    await moveRow(misplaced.row, dest[misplaced.statusBucket]);
    invalidateCache();
    moved.push({ name: misplaced.name, bucket: misplaced.statusBucket });
  }
  return { moved };
}

/** One human-readable App Activity line per timeline event (append format). */
function activityLine(ev: TimelineEvent): string {
  const stamp = new Date(ev.at);
  return `[${stamp.toLocaleDateString("en-US")} ${ev.who} · ${ev.kind}] ${ev.text}${ev.editedBy ? ` (edited by ${ev.editedBy})` : ""}`;
}

/**
 * Edit a past timeline entry (rep fixed a typo, added detail, corrected a
 * call note). Keeps an audit trail on the event and rebuilds the App
 * Activity column so the sheet's readable log matches.
 */
export async function updateTimelineEvent(
  lead: Lead,
  shape: SheetShape,
  index: number,
  text: string,
  who: string
): Promise<TimelineEvent> {
  if (index < 0 || index >= lead.timeline.length) throw new Error(`No timeline entry at index ${index}`);
  const s = await ensureAppColumns(shape);
  const timeline = [...lead.timeline];
  const ev = { ...timeline[index], text: text.trim(), editedBy: who, editedAt: new Date().toISOString() };
  timeline[index] = ev;
  const target = await ensureRowCurrent(lead, s);
  await writeCells([
    { row: target.row, col: requireCol(s, "timelineJson"), value: JSON.stringify(timeline) },
    { row: target.row, col: requireCol(s, "appActivity"), value: timeline.map(activityLine).join("\n") },
  ]);
  invalidateCache();
  return ev;
}
