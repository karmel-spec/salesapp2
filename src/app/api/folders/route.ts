import { NextRequest, NextResponse } from "next/server";
import { listFolders, addFolder } from "@/lib/folders";
import { requireSession, jsonError } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const guard = requireSession(req);
  if (guard) return guard;
  try {
    return NextResponse.json({ folders: await listFolders() });
  } catch (err) {
    return jsonError(err);
  }
}

export async function POST(req: NextRequest) {
  const guard = requireSession(req);
  if (guard) return guard;
  try {
    const body = await req.json();
    const folders = await addFolder(String(body.name || ""), body.who || "team");
    return NextResponse.json({ ok: true, folders });
  } catch (err) {
    return jsonError(err, 400);
  }
}
