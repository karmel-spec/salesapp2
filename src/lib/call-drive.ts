import { config } from "./config";
import { getGoogleToken } from "./sheets";

/**
 * File a recorded call into the shared "Phone Call Recordings" Drive folder,
 * the same way the phone-line bots do, so sales calls sit next to the rest:
 *
 *   Phone Call Recordings / 2026 / 11 November / 2026-11-04 /
 *     <Name> <Type> 2026-11-04 1-05 PM MT <CallSid> audio.mp3
 *     <Name> <Type> 2026-11-04 1-05 PM MT <CallSid> transcript   (Google Doc)
 *
 * Plain Drive REST with the Sheets service account (it has the drive scope).
 * Idempotent: a re-fired callback finds the existing files by name.
 */

const TZ = "America/Denver";
const DRIVE = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3";
const FOLDER = "application/vnd.google-apps.folder";
const GDOC = "application/vnd.google-apps.document";

export function callDriveConfigured(): boolean {
  return Boolean(config.callRecordingsFolderId && config.googleClientEmail && config.googlePrivateKey);
}

const q = (s: string) => s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

async function drive(path: string, init: RequestInit = {}): Promise<any> {
  const token = await getGoogleToken();
  const sep = path.includes("?") ? "&" : "?";
  const res = await fetch(`${path.startsWith("http") ? path : DRIVE + path}${sep}supportsAllDrives=true`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.headers || {}) },
  });
  if (!res.ok) throw new Error(`Drive ${init.method || "GET"} ${path.split("?")[0]} failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

async function findChild(parentId: string, name: string, mimeType?: string): Promise<{ id: string; webViewLink: string } | null> {
  const query = `name = '${q(name)}' and '${parentId}' in parents and trashed = false${mimeType ? ` and mimeType = '${mimeType}'` : ""}`;
  const j = await drive(`/files?q=${encodeURIComponent(query)}&fields=files(id,webViewLink)&pageSize=1&includeItemsFromAllDrives=true`);
  return j.files?.[0] || null;
}

async function ensureFolder(parentId: string, name: string): Promise<string> {
  const hit = await findChild(parentId, name, FOLDER);
  if (hit) return hit.id;
  const j = await drive(`/files?fields=id`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, mimeType: FOLDER, parents: [parentId] }),
  });
  return j.id as string;
}

/** Multipart upload; `convertTo` turns a text upload into a native Google Doc. */
async function upload(parentId: string, name: string, contentType: string, body: Buffer | string, convertTo?: string): Promise<{ id: string; webViewLink: string }> {
  const existing = await findChild(parentId, name);
  if (existing) return existing;
  const boundary = `blp${Date.now().toString(36)}`;
  const meta = JSON.stringify({ name, parents: [parentId], ...(convertTo ? { mimeType: convertTo } : {}) });
  const head = Buffer.from(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`
  );
  const tail = Buffer.from(`\r\n--${boundary}--`);
  const payload = Buffer.concat([head, Buffer.isBuffer(body) ? body : Buffer.from(body), tail]);
  return drive(`${UPLOAD}/files?uploadType=multipart&fields=id,webViewLink`, {
    method: "POST",
    headers: { "Content-Type": `multipart/related; boundary=${boundary}`, "Content-Length": String(payload.length) },
    body: payload,
  });
}

function parts(at: Date) {
  const get = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-US", { timeZone: TZ, ...opts }).format(at);
  const year = get({ year: "numeric" });
  const month2 = get({ month: "2-digit" });
  const monthName = get({ month: "long" });
  const day = `${year}-${month2}-${get({ day: "2-digit" })}`;
  const time = get({ hour: "numeric", minute: "2-digit", hour12: true }).replace(":", "-"); // "1-05 PM"
  return { year, monthFolder: `${month2} ${monthName}`, day, time, stamp: get({ weekday: "long", month: "numeric", day: "numeric", year: "2-digit", hour: "numeric", minute: "2-digit" }) };
}

// Drive file names: keep letters/digits/space/dash/dot, like the bots' files.
const clean = (s: string) => s.replace(/[\\/:*?"<>|#]/g, " ").replace(/\s+/g, " ").trim();

export interface CallFiling {
  at: Date;
  callSid: string;
  leadName: string; // "Unknown caller" when nobody matched
  callType?: string; // "Sales" for app-dialed calls
  direction: "outbound" | "inbound";
  durationSec?: number | null;
  rep?: string;
  otherParty?: string; // E.164 of the customer side
  callerId?: string;
  audio: Buffer;
  transcript: string;
  summary: string;
  leadUrl?: string;
  audioUrl?: string; // the permanent Supabase link, for cross-reference
}

export interface CallFiled {
  folderLink: string;
  audioLink: string;
  docLink: string;
}

export async function fileCallToDrive(c: CallFiling): Promise<CallFiled> {
  if (!callDriveConfigured()) throw new Error("Call recordings folder not configured (CALL_RECORDINGS_FOLDER_ID + Google service account)");
  const p = parts(c.at);
  const yearId = await ensureFolder(config.callRecordingsFolderId, p.year);
  const monthId = await ensureFolder(yearId, p.monthFolder);
  const dayId = await ensureFolder(monthId, p.day);

  const base = clean(`${c.leadName || "Unknown caller"} ${c.callType || "Sales"} ${p.day} ${p.time} MT ${c.callSid}`);
  const mins = c.durationSec ? `${Math.floor(c.durationSec / 60)}:${String(c.durationSec % 60).padStart(2, "0")}` : "unknown length";

  const audio = await upload(dayId, `${base} audio.mp3`, "audio/mpeg", c.audio);

  const doc =
    `# ${base} transcript\n\n` +
    `${p.stamp} MT. ${c.direction === "outbound" ? "Outbound sales call" : "Inbound call"}` +
    `${c.rep ? ` by ${c.rep}` : ""} from the Sales App` +
    `${c.callerId ? ` (caller ID ${c.callerId})` : ""}${c.otherParty ? ` to ${c.otherParty}` : ""}.` +
    `${c.leadName && c.leadName !== "Unknown caller" ? ` Lead: ${c.leadName}${c.leadUrl ? ` — ${c.leadUrl}` : ""}.` : " No lead matched."}\n\n` +
    `CallSid ${c.callSid}. Length ${mins}. Recording: ${audio.webViewLink}${c.audioUrl ? ` (also ${c.audioUrl})` : ""}.\n\n` +
    `## Summary\n\n${c.summary || "No summary available."}\n\n` +
    `## Transcript\n\n${c.transcript || "No transcript available — listen to the audio."}\n`;
  const transcript = await upload(dayId, `${base} transcript`, "text/plain; charset=UTF-8", doc, GDOC);

  return {
    folderLink: `https://drive.google.com/drive/folders/${dayId}`,
    audioLink: audio.webViewLink,
    docLink: transcript.webViewLink,
  };
}
