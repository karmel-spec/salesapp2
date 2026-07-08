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

export type StatusBucket = "new" | "active" | "won" | "lost" | "inactive" | "support";

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
  if (s.includes("inactive") || s.includes("snooze") || s.includes("past 30")) return "inactive";
  if (s.includes("active") || s.includes("working") || s.includes("open")) return "active";
  return "active";
}

export function normRep(raw: string): string {
  const s = raw.trim().toLowerCase().replace(/\s+/g, " ");
  if (!s) return "";
  if (s.includes("brigham") || /\bbl\b/.test(s)) return "Brigham";
  if (s.includes("karmel")) return "Karmel";
  if (s.includes("sally")) return "Sally";
  if (s.includes("melissa")) return "Melissa";
  if (s.includes("arnold")) return "Arnold";
  // Anything that doesn't look like a short person name (notes, dates,
  // "O:/W:/C:" scribbles) is treated as unassigned rather than a rep.
  if (/[\d:@/]/.test(s) || s.split(" ").length > 3 || s.length > 24) return "";
  return s.replace(/(^|\s)\w/g, (c) => c.toUpperCase());
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
  const bucket = normStatus(statusRaw);
  const repRaw = get("rep");
  const rep = normRep(repRaw);
  const dateAdded = get("dateAdded");
  const lastContact = get("lastContact");

  const timeline = safeJson<TimelineEvent[]>(get("timelineJson"), []);
  // Last touch = explicit last-contact date, else newest timeline event, else date added.
  const timelineDates = timeline
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
  const isStale = openBucket && daysSince !== null && daysSince >= config.staleDays;

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
    rep,
    repRaw,
    // Stale open leads are Arnold's by rule; brand-new unassigned leads default to Brigham.
    effectiveRep: isStale ? config.staleRep : rep || (openBucket ? config.defaultRep : rep),
    headline: get("headline").trim(),
    score: get("score").trim(),
    firstName: first,
    lastName: last,
    name: [first, last].filter(Boolean).join(" ") || "(no name)",
    activityTimeline: get("activityTimeline"),
    notes: get("notes"),
    phone: get("phone"),
    phoneDialable: extractPhone(get("phone")),
    email: get("email"),
    emailClean: extractEmail(get("email")),
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
    // Skip fully empty rows.
    if (!row.some((c) => c && c.trim())) continue;
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
 * Stale sweep: persist the 30-day rule back to the sheet — any open lead
 * with no contact in >= staleDays gets reassigned to Arnold in the rep column.
 * Returns the leads that were reassigned.
 */
export async function applyStaleAssignments(): Promise<Lead[]> {
  const { leads, shape } = await getLeads(true);
  const targets = leads.filter((l) => l.isStale && l.rep !== config.staleRep);
  if (!targets.length) return [];
  const repCol = requireCol(shape, "rep");
  await writeCells(targets.map((l) => ({ row: l.row, col: repCol, value: config.staleRep })));
  for (const l of targets) {
    await appendTimeline(l, shape, {
      at: new Date().toISOString(),
      who: "app",
      kind: "assign",
      text: `Auto-reassigned to ${config.staleRep} (${l.daysSinceContact}d since last contact, was "${l.repRaw || "unassigned"}")`,
    });
  }
  invalidateCache();
  return targets;
}
