import crypto from "crypto";
import { ensureTab, readTab, writeTab } from "./sheets";

/**
 * Scheduled sends — texts/emails written now, delivered later. Stored in a
 * "Scheduled Sends" tab; a LaunchAgent pings /api/scheduled/dispatch every
 * few minutes and anything due goes out through the normal send pipeline
 * (per-rep identity, open tracking, timeline logging).
 */

const TAB = "Scheduled Sends";
const HEADER = [
  "id", "leadId", "leadName", "channel", "subject", "body",
  "sendAt", "sendAs", "who", "status", "createdAt", "sentAt", "error",
];

export interface ScheduledSend {
  id: string;
  leadId: string;
  leadName: string;
  channel: "sms" | "email";
  subject: string;
  body: string;
  sendAt: string; // ISO
  sendAs: string; // email identity ("" = info@)
  who: string;
  status: "pending" | "sent" | "canceled" | "failed";
  createdAt: string;
  sentAt: string;
  error: string;
}

function parse(rows: string[][]): ScheduledSend[] {
  if (rows.length < 2) return [];
  const idx = Object.fromEntries(HEADER.map((h) => [h, rows[0].indexOf(h)])) as Record<string, number>;
  const get = (r: string[], k: string) => (idx[k] >= 0 ? (r[idx[k]] ?? "").toString() : "");
  return rows
    .slice(1)
    .filter((r) => get(r, "id"))
    .map((r) => ({
      id: get(r, "id"),
      leadId: get(r, "leadId"),
      leadName: get(r, "leadName"),
      channel: (get(r, "channel") as "sms" | "email") || "sms",
      subject: get(r, "subject"),
      body: get(r, "body"),
      sendAt: get(r, "sendAt"),
      sendAs: get(r, "sendAs"),
      who: get(r, "who"),
      status: (get(r, "status") as ScheduledSend["status"]) || "pending",
      createdAt: get(r, "createdAt"),
      sentAt: get(r, "sentAt"),
      error: get(r, "error"),
    }));
}

function serialize(items: ScheduledSend[]): string[][] {
  return [
    HEADER,
    ...items.map((x) => [
      x.id, x.leadId, x.leadName, x.channel, x.subject, x.body,
      x.sendAt, x.sendAs, x.who, x.status, x.createdAt, x.sentAt, x.error,
    ]),
  ];
}

export async function listScheduled(leadId?: string): Promise<ScheduledSend[]> {
  const all = parse(await readTab(TAB));
  return leadId ? all.filter((x) => x.leadId === leadId) : all;
}

export async function addScheduled(input: {
  leadId: string;
  leadName: string;
  channel: "sms" | "email";
  subject?: string;
  body: string;
  sendAt: string;
  sendAs?: string;
  who: string;
}): Promise<ScheduledSend> {
  await ensureTab(TAB);
  const items = parse(await readTab(TAB));
  const item: ScheduledSend = {
    id: crypto.randomBytes(8).toString("hex"),
    leadId: input.leadId,
    leadName: input.leadName,
    channel: input.channel,
    subject: (input.subject || "").slice(0, 300),
    body: input.body.slice(0, 4000),
    sendAt: input.sendAt,
    sendAs: input.sendAs || "",
    who: input.who,
    status: "pending",
    createdAt: new Date().toISOString(),
    sentAt: "",
    error: "",
  };
  items.push(item);
  await writeTab(TAB, serialize(items));
  return item;
}

export async function updateScheduled(
  id: string,
  patch: Partial<Pick<ScheduledSend, "status" | "sentAt" | "error">>
): Promise<ScheduledSend | null> {
  const items = parse(await readTab(TAB));
  const item = items.find((x) => x.id === id);
  if (!item) return null;
  Object.assign(item, patch);
  await writeTab(TAB, serialize(items));
  return item;
}

/** Pending sends whose time has come. */
export async function dueScheduled(now = new Date()): Promise<ScheduledSend[]> {
  return (await listScheduled()).filter(
    (x) => x.status === "pending" && x.sendAt && new Date(x.sendAt).getTime() <= now.getTime()
  );
}
