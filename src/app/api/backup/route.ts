import { NextRequest, NextResponse } from "next/server";
import { runBackup, listBackups } from "@/lib/backup";
import { requireSession, jsonError } from "@/lib/api";
import { isValidArnoldKey } from "@/lib/auth";
import { config } from "@/lib/config";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** List Leads Log backups (Settings page). */
export async function GET(req: NextRequest) {
  const guard = requireSession(req);
  if (guard) return guard;
  try {
    if (!config.driveBackupFolderId) {
      return NextResponse.json({ configured: false, serviceAccount: config.googleClientEmail, files: [] });
    }
    const files = await listBackups();
    return NextResponse.json({ configured: true, files });
  } catch (err) {
    return jsonError(err);
  }
}

/** Run a backup now (Settings button, or the nightly job via agent key). */
export async function POST(req: NextRequest) {
  const guard = requireSession(req);
  if (guard && !isValidArnoldKey(req.headers.get("x-blp-key"))) return guard;
  try {
    const result = await runBackup();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return jsonError(err);
  }
}
