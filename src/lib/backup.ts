import { readRows } from "./sheets";
import { uploadObject, listObjects, deleteObjects, signedUrl, storageConfigured } from "./supastore";

/**
 * Leads Log backups: CSV snapshots of the whole sheet, stored in the
 * PRIVATE Supabase bucket `blp-backups` (the customer list must never be
 * publicly reachable). A nightly job triggers POST /api/backup; the
 * Settings page lists the files with 1-hour download links. Retention:
 * newest KEEP_COUNT files are kept.
 *
 * History: these used to go to Google Drive until Google cut off
 * service-account uploads ("Service Accounts do not have storage quota"),
 * which silently broke the nightly job — hence Supabase.
 */

const KEEP_COUNT = 30;
const BUCKET = "blp-backups";
const PREFIX = ""; // flat at the bucket root, named leads-log-backup-…

export interface BackupFile {
  id: string;
  name: string;
  createdTime: string;
  size?: string;
  webViewLink?: string;
}

export function backupsConfigured(): boolean {
  return storageConfigured();
}

function toCsv(rows: string[][]): string {
  return rows
    .map((r) => r.map((c) => (/[",\n]/.test(c ?? "") ? `"${(c ?? "").replace(/"/g, '""')}"` : c ?? "")).join(","))
    .join("\r\n");
}

export async function listBackups(): Promise<BackupFile[]> {
  const objects = (await listObjects(BUCKET, PREFIX, 60)).filter((o) => o.name.includes("leads-log-backup-"));
  return Promise.all(
    objects.map(async (o) => ({
      id: o.name,
      name: o.name,
      createdTime: o.createdTime,
      size: o.size != null ? String(o.size) : undefined,
      webViewLink: await signedUrl(BUCKET, o.name, 3600),
    }))
  );
}

export async function runBackup(): Promise<{ file: BackupFile; rows: number; pruned: number }> {
  const rows = await readRows();
  const csv = toCsv(rows);
  const stamp = new Date().toISOString().slice(0, 16).replace("T", "-").replace(":", "");
  const name = `leads-log-backup-${stamp}.csv`;

  await uploadObject(BUCKET, name, Buffer.from(csv, "utf8"), "text/csv");

  // Retention: prune beyond the newest KEEP_COUNT.
  const all = (await listObjects(BUCKET, PREFIX, 200)).filter((o) => o.name.includes("leads-log-backup-"));
  const stale = all.slice(KEEP_COUNT).map((o) => o.name);
  await deleteObjects(BUCKET, stale);

  return {
    file: { id: name, name, createdTime: new Date().toISOString(), size: String(csv.length) },
    rows: rows.length,
    pruned: stale.length,
  };
}
