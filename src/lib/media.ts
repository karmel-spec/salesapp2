import crypto from "crypto";
import fs from "fs";
import path from "path";
import { getStore } from "@netlify/blobs";
import { config } from "./config";

/**
 * Photo attachments for outbound texts/emails. Twilio MMS needs a public
 * URL and Google Drive no longer lets service accounts own files, so photos
 * live in Netlify Blobs and are served by our own public /api/media/<key>
 * route (unguessable 128-bit keys). In local dev (no Netlify runtime) they
 * fall back to a .media-cache/ folder so the flow is testable end-to-end.
 */

const STORE = "lead-media";
const DEV_DIR = path.join(process.cwd(), ".media-cache");

function blobStore() {
  return getStore({ name: STORE, consistency: "strong" });
}

export interface StoredPhoto {
  key: string;
  /** Public URL — usable as a Twilio MediaUrl and in <img>. */
  url: string;
}

export async function saveLeadPhoto(leadId: string, mimeType: string, data: Buffer): Promise<StoredPhoto> {
  const ext = (mimeType.split("/")[1] || "jpg").replace(/[^a-z0-9]/gi, "");
  const key = `${leadId}-${crypto.randomBytes(16).toString("hex")}.${ext}`;
  try {
    const buf = new ArrayBuffer(data.length);
    new Uint8Array(buf).set(data);
    await blobStore().set(key, buf, { metadata: { mimeType, leadId } });
  } catch {
    // Local dev: no Netlify Blobs runtime — keep it on disk.
    fs.mkdirSync(DEV_DIR, { recursive: true });
    fs.writeFileSync(path.join(DEV_DIR, key), data);
  }
  // MEDIA_BASE_URL lets local dev point photo links at localhost without
  // touching PUBLIC_BASE_URL (which OAuth callbacks depend on).
  const base = process.env.MEDIA_BASE_URL || config.publicBaseUrl;
  return { key, url: `${base}/api/media/${key}` };
}

export async function readLeadPhoto(key: string): Promise<{ data: Buffer; mimeType: string } | null> {
  if (!/^[\w.-]+$/.test(key)) return null; // no path tricks
  try {
    const store = blobStore();
    const res = await store.getWithMetadata(key, { type: "arrayBuffer" });
    if (res?.data) {
      return { data: Buffer.from(res.data), mimeType: String(res.metadata?.mimeType || "image/jpeg") };
    }
  } catch {
    /* fall through to dev cache */
  }
  const file = path.join(DEV_DIR, key);
  if (fs.existsSync(file)) {
    const ext = key.split(".").pop() || "jpg";
    return { data: fs.readFileSync(file), mimeType: `image/${ext === "jpg" ? "jpeg" : ext}` };
  }
  return null;
}
