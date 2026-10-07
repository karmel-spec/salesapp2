import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/api";
import { config } from "@/lib/config";
import { qboConfigured, connectUrl } from "@/lib/qbo";

export const dynamic = "force-dynamic";

/** One-time: a signed-in team member links the QuickBooks company (redirects to Intuit). */
export async function GET(req: NextRequest) {
  const guard = requireSession(req);
  if (guard) return guard;
  if (!qboConfigured()) return NextResponse.json({ error: "Set QBO_CLIENT_ID and QBO_CLIENT_SECRET (developer.intuit.com app) first" }, { status: 400 });
  const state = Math.random().toString(36).slice(2);
  const res = NextResponse.redirect(connectUrl(`${config.publicBaseUrl}/api/qbo/callback`, state));
  res.cookies.set("qbo_state", state, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 600 });
  return res;
}
