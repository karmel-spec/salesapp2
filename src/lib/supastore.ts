/**
 * Supabase Storage — BLP's file store (the blp-crm project's Storage).
 * Replaces Google Drive, which stopped allowing service-account uploads
 * ("Service Accounts do not have storage quota", 2025 policy).
 *
 * Buckets:
 *  - blp-backups (private): nightly Leads Log CSV snapshots
 *  - blp-media  (public):  permanent call audio, future shared files
 *
 * Env (not in config.ts to keep that file's pending local diff untouched):
 *  SUPABASE_URL, SUPABASE_SERVICE_KEY
 */

const URL_BASE = process.env.SUPABASE_URL || "";
const KEY = process.env.SUPABASE_SERVICE_KEY || "";

export function storageConfigured(): boolean {
  return Boolean(URL_BASE && KEY);
}

function requireCfg() {
  if (!storageConfigured()) {
    throw new Error("Supabase storage not configured: set SUPABASE_URL and SUPABASE_SERVICE_KEY");
  }
}

async function storage(path: string, init?: RequestInit): Promise<Response> {
  requireCfg();
  const res = await fetch(`${URL_BASE}/storage/v1${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${KEY}`, ...(init?.headers || {}) },
  });
  if (!res.ok) {
    throw new Error(`Supabase storage failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  }
  return res;
}

export async function uploadObject(bucket: string, objectPath: string, data: Buffer, contentType: string): Promise<void> {
  const body = new ArrayBuffer(data.length);
  new Uint8Array(body).set(data);
  await storage(`/object/${bucket}/${objectPath}`, {
    method: "POST",
    headers: { "Content-Type": contentType, "x-upsert": "true" },
    body,
  });
}

export interface StoredObject {
  name: string;
  createdTime: string;
  size?: number;
}

export async function listObjects(bucket: string, prefix = "", limit = 100): Promise<StoredObject[]> {
  const res = await storage(`/object/list/${bucket}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prefix, limit, sortBy: { column: "created_at", order: "desc" } }),
  });
  const items = (await res.json()) as { name: string; created_at?: string; metadata?: { size?: number } }[];
  return items
    .filter((i) => i.name && !i.name.startsWith(".")) // skip placeholder objects
    .map((i) => ({
      name: prefix ? `${prefix}/${i.name}`.replace(/^\/+/, "") : i.name,
      createdTime: i.created_at || "",
      size: i.metadata?.size,
    }));
}

export async function deleteObjects(bucket: string, objectPaths: string[]): Promise<void> {
  if (!objectPaths.length) return;
  await storage(`/object/${bucket}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prefixes: objectPaths }),
  });
}

/** Permanent URL for objects in a PUBLIC bucket (e.g. blp-media). */
export function publicUrl(bucket: string, objectPath: string): string {
  return `${URL_BASE}/storage/v1/object/public/${bucket}/${objectPath}`;
}

/** Time-limited download link for a PRIVATE bucket (e.g. blp-backups). */
export async function signedUrl(bucket: string, objectPath: string, expiresInSec = 3600): Promise<string> {
  const res = await storage(`/object/sign/${bucket}/${objectPath}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ expiresIn: expiresInSec }),
  });
  const { signedURL } = (await res.json()) as { signedURL: string };
  return `${URL_BASE}/storage/v1${signedURL}`;
}
