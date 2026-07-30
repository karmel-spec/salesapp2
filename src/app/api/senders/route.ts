import { NextRequest, NextResponse } from "next/server";
import { requireSession, jsonError } from "@/lib/api";
import { config } from "@/lib/config";

export const dynamic = "force-dynamic";

/**
 * Email identities the app can send from: the shared info@ box plus any
 * rep with SMTP_USER_<REP>/SMTP_PASS_<REP> configured (Gmail app password).
 * Drives the "send from…" choice on draft approvals and composers.
 */
export async function GET(req: NextRequest) {
  const guard = requireSession(req);
  if (guard) return guard;
  try {
    const senders: { key: string; label: string }[] = [{ key: "", label: config.smtpUser }];
    for (const [k, v] of Object.entries(process.env)) {
      const m = k.match(/^SMTP_USER_([A-Z]+)$/);
      if (!m || !v || !process.env[`SMTP_PASS_${m[1]}`]) continue;
      const rep = m[1].charAt(0) + m[1].slice(1).toLowerCase();
      senders.push({ key: rep, label: String(v) });
    }
    return NextResponse.json({ senders });
  } catch (err) {
    return jsonError(err);
  }
}
