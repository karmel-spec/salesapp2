import { ensureTab, readTab, writeTab } from "./sheets";

/**
 * Unfiled Plaud calls — recordings the matcher couldn't attach to a lead.
 * Persisted in a "Plaud Unfiled" tab of the Leads Log so they survive
 * serverless restarts and every rep sees the same queue. Rows are kept
 * (status flips to filed/dismissed) as an audit trail.
 */

const TAB = "Plaud Unfiled";
const HEADER = [
  "recordingId", "receivedAt", "startedAt", "title", "durationSec",
  "summary", "transcriptExcerpt", "status", "filedTo", "filedBy", "filedAt",
];

export interface UnfiledCall {
  recordingId: string;
  receivedAt: string;
  startedAt: string;
  title: string;
  durationSec: number | null;
  summary: string;
  transcriptExcerpt: string;
  status: "open" | "filed" | "dismissed";
  filedTo: string;
  filedBy: string;
  filedAt: string;
}

function parse(rows: string[][]): UnfiledCall[] {
  if (rows.length < 2) return [];
  const idx = Object.fromEntries(HEADER.map((h, i) => [h, rows[0].indexOf(h)])) as Record<string, number>;
  const get = (r: string[], k: string) => (idx[k] >= 0 ? (r[idx[k]] ?? "").toString() : "");
  return rows.slice(1).filter((r) => get(r, "recordingId")).map((r) => ({
    recordingId: get(r, "recordingId"),
    receivedAt: get(r, "receivedAt"),
    startedAt: get(r, "startedAt"),
    title: get(r, "title"),
    durationSec: Number(get(r, "durationSec")) || null,
    summary: get(r, "summary"),
    transcriptExcerpt: get(r, "transcriptExcerpt"),
    status: (get(r, "status") as UnfiledCall["status"]) || "open",
    filedTo: get(r, "filedTo"),
    filedBy: get(r, "filedBy"),
    filedAt: get(r, "filedAt"),
  }));
}

function serialize(items: UnfiledCall[]): string[][] {
  return [
    HEADER,
    ...items.map((c) => [
      c.recordingId, c.receivedAt, c.startedAt, c.title, c.durationSec == null ? "" : String(c.durationSec),
      c.summary, c.transcriptExcerpt, c.status, c.filedTo, c.filedBy, c.filedAt,
    ]),
  ];
}

export async function listUnfiled(): Promise<UnfiledCall[]> {
  return parse(await readTab(TAB));
}

/** Add a recording to the queue (no-op if it's already there). */
export async function addUnfiled(item: Omit<UnfiledCall, "receivedAt" | "status" | "filedTo" | "filedBy" | "filedAt">): Promise<boolean> {
  await ensureTab(TAB);
  const items = parse(await readTab(TAB));
  if (items.some((c) => c.recordingId === item.recordingId)) return false;
  items.push({
    ...item,
    summary: item.summary.slice(0, 4000),
    transcriptExcerpt: (item.transcriptExcerpt || "").slice(0, 6000),
    receivedAt: new Date().toISOString(),
    status: "open",
    filedTo: "",
    filedBy: "",
    filedAt: "",
  });
  await writeTab(TAB, serialize(items));
  return true;
}

/** Mark a queued recording filed (to a lead) or dismissed (not a lead call). */
export async function resolveUnfiled(
  recordingId: string,
  status: "filed" | "dismissed",
  filedTo: string,
  filedBy: string
): Promise<UnfiledCall | null> {
  const items = parse(await readTab(TAB));
  const item = items.find((c) => c.recordingId === recordingId);
  if (!item || item.status !== "open") return null;
  item.status = status;
  item.filedTo = filedTo;
  item.filedBy = filedBy;
  item.filedAt = new Date().toISOString();
  await writeTab(TAB, serialize(items));
  return item;
}
