import { readRows, getGoogleToken } from "./sheets";
import { config } from "./config";

/**
 * Leads Log backups: CSV snapshots of the whole sheet uploaded to a Google
 * Drive folder that Karmel shared with the service account. A nightly
 * LaunchAgent on the Mac triggers POST /api/backup; the Settings page lists
 * the files. Retention: newest KEEP_COUNT files are kept.
 */

const KEEP_COUNT = 30;
const DRIVE = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3";

export interface BackupFile {
  id: string;
  name: string;
  createdTime: string;
  size?: string;
  webViewLink?: string;
}

function toCsv(rows: string[][]): string {
  return rows
    .map((r) => r.map((c) => (/[",\n]/.test(c ?? "") ? `"${(c ?? "").replace(/"/g, '""')}"` : c ?? "")).join(","))
    .join("\r\n");
}

function requireFolder(): string {
  if (!config.driveBackupFolderId) {
    throw new Error(
      `Backups not configured: create a Drive folder, share it with ${config.googleClientEmail} as Editor, and set DRIVE_BACKUP_FOLDER_ID to the folder's ID.`
    );
  }
  return config.driveBackupFolderId;
}

async function drive(path: string, init?: RequestInit): Promise<any> {
  const token = await getGoogleToken();
  const res = await fetch(path.startsWith("http") ? path : `${DRIVE}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init?.headers || {}) },
  });
  if (!res.ok) throw new Error(`Drive API failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  return res.status === 204 ? null : res.json();
}

export async function listBackups(): Promise<BackupFile[]> {
  const folder = requireFolder();
  const q = encodeURIComponent(`'${folder}' in parents and trashed = false`);
  const data = await drive(
    `/files?q=${q}&orderBy=createdTime desc&pageSize=60&fields=files(id,name,createdTime,size,webViewLink)&supportsAllDrives=true&includeItemsFromAllDrives=true`
  );
  return (data.files || []) as BackupFile[];
}

export async function runBackup(): Promise<{ file: BackupFile; rows: number; pruned: number }> {
  const folder = requireFolder();
  const rows = await readRows();
  const csv = toCsv(rows);
  const stamp = new Date().toISOString().slice(0, 16).replace("T", "-").replace(":", "");
  const name = `leads-log-backup-${stamp}.csv`;

  // Multipart upload: metadata + CSV content in one request.
  const boundary = "blp-backup-boundary";
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
    JSON.stringify({ name, parents: [folder], mimeType: "text/csv" }) +
    `\r\n--${boundary}\r\nContent-Type: text/csv\r\n\r\n` +
    csv +
    `\r\n--${boundary}--`;
  const file = (await drive(
    `${UPLOAD}/files?uploadType=multipart&fields=id,name,createdTime,size,webViewLink&supportsAllDrives=true`,
    {
      method: "POST",
      headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
      body,
    }
  )) as BackupFile;

  // Retention: prune beyond the newest KEEP_COUNT.
  const all = await listBackups();
  const stale = all.slice(KEEP_COUNT);
  for (const f of stale) {
    await drive(`/files/${f.id}?supportsAllDrives=true`, { method: "DELETE" });
  }

  return { file, rows: rows.length, pruned: stale.length };
}
