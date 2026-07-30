import crypto from "crypto";
import { ensureTab, readTab, writeTab } from "./sheets";

/**
 * Message templates — pre-written texts/emails the team reuses from the
 * conversation composer. Stored in a "Templates" tab of the Leads Log so
 * everyone shares one list. Placeholders {firstName} {name} {rep} are
 * filled in by the composer when a template is inserted.
 */

const TAB = "Templates";
const HEADER = ["id", "name", "channel", "subject", "body", "createdBy", "createdAt"];

export interface Template {
  id: string;
  name: string;
  channel: "sms" | "email" | "both";
  subject: string;
  body: string;
  createdBy: string;
  createdAt: string;
}

function parse(rows: string[][]): Template[] {
  if (rows.length < 2) return [];
  const idx = Object.fromEntries(HEADER.map((h) => [h, rows[0].indexOf(h)])) as Record<string, number>;
  const get = (r: string[], k: string) => (idx[k] >= 0 ? (r[idx[k]] ?? "").toString() : "");
  return rows
    .slice(1)
    .filter((r) => get(r, "id"))
    .map((r) => ({
      id: get(r, "id"),
      name: get(r, "name"),
      channel: (get(r, "channel") as Template["channel"]) || "both",
      subject: get(r, "subject"),
      body: get(r, "body"),
      createdBy: get(r, "createdBy"),
      createdAt: get(r, "createdAt"),
    }));
}

export async function listTemplates(): Promise<Template[]> {
  const items = parse(await readTab(TAB));
  return items.sort((a, b) => a.name.localeCompare(b.name));
}

export async function addTemplate(input: {
  name: string;
  channel: Template["channel"];
  subject?: string;
  body: string;
  who: string;
}): Promise<Template> {
  await ensureTab(TAB);
  const items = parse(await readTab(TAB));
  const t: Template = {
    id: crypto.randomBytes(6).toString("hex"),
    name: input.name.trim().slice(0, 60),
    channel: input.channel,
    subject: (input.subject || "").slice(0, 200),
    body: input.body.slice(0, 4000),
    createdBy: input.who,
    createdAt: new Date().toISOString(),
  };
  items.push(t);
  await writeTab(TAB, [HEADER, ...items.map((x) => [x.id, x.name, x.channel, x.subject, x.body, x.createdBy, x.createdAt])]);
  return t;
}
