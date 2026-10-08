import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { mirrorCrmContact } from "@/lib/leads";
import { CRM_KEY, type CrmCard } from "@/lib/crm";
export const dynamic = "force-dynamic";

/**
 * The CRM calls this the moment someone edits a client's contact details
 * there, so the Leads Log mirror converges immediately instead of waiting for
 * the next time a human opens the lead. Same shared x-blp-key as every other
 * server-to-server BLP call.
 */
function keyOk(req: NextRequest): boolean {
  const got = Buffer.from(req.headers.get("x-blp-key") || "");
  const want = Buffer.from(CRM_KEY);
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

export async function POST(req: NextRequest) {
  if (!keyOk(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body = (await req.json().catch(() => null)) as { blp_id?: string; client?: CrmCard } | null;
  if (!body?.blp_id || !body.client) return NextResponse.json({ error: "blp_id and client required" }, { status: 400 });
  try {
    const synced = await mirrorCrmContact(String(body.blp_id), body.client);
    return NextResponse.json({ ok: true, synced });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e instanceof Error ? e.message : e).slice(0, 200) }, { status: 500 });
  }
}
