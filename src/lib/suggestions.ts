import crypto from "crypto";
import { ensureTab, readTab, writeTab } from "./sheets";

/**
 * Cross-app suggestion box (the 💡 widget every BLP app embeds). One central
 * list in an "App Suggestions" tab; status flows Requested → In progress →
 * Live → Tested (the requester confirms Tested from the widget).
 */

const TAB = "App Suggestions";
const HEADER = ["id", "at", "app", "who", "type", "text", "context", "screenshot", "status"];

export interface Suggestion {
  id: string;
  at: string;
  app: string;
  who: string;
  type: string; // edit | idea | bug
  text: string;
  context: string;
  screenshot: string;
  status: string;
}

function fromRow(r: string[]): Suggestion {
  return {
    id: r[0] || "",
    at: r[1] || "",
    app: r[2] || "",
    who: r[3] || "",
    type: r[4] || "idea",
    text: r[5] || "",
    context: r[6] || "",
    screenshot: r[7] || "",
    status: r[8] || "Requested",
  };
}

export async function listSuggestions(): Promise<Suggestion[]> {
  const rows = await readTab(TAB);
  return rows.slice(1).map(fromRow).filter((s) => s.id);
}

export async function addSuggestion(input: {
  app: string;
  who: string;
  type: string;
  text: string;
  context?: string;
  screenshot?: string;
}): Promise<Suggestion> {
  await ensureTab(TAB);
  const rows = await readTab(TAB);
  const all = rows.length ? rows : [HEADER];
  const s: Suggestion = {
    id: `SG-${crypto.randomBytes(3).toString("hex").toUpperCase()}`,
    at: new Date().toISOString(),
    app: input.app.slice(0, 40),
    who: input.who.slice(0, 40),
    type: ["edit", "idea", "bug"].includes(input.type) ? input.type : "idea",
    text: input.text.slice(0, 1500),
    context: (input.context || "").slice(0, 200),
    screenshot: input.screenshot || "",
    status: "Requested",
  };
  all.push([s.id, s.at, s.app, s.who, s.type, s.text, s.context, s.screenshot, s.status]);
  await writeTab(TAB, all);
  return s;
}

export async function setSuggestionStatus(id: string, status: string): Promise<boolean> {
  const rows = await readTab(TAB);
  const i = rows.findIndex((r, n) => n > 0 && (r[0] || "") === id);
  if (i < 0) return false;
  while (rows[i].length < HEADER.length) rows[i].push("");
  rows[i][8] = status;
  await writeTab(TAB, rows);
  return true;
}
