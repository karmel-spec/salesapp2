import { NextRequest, NextResponse } from "next/server";
import { parseGoogleSession, isValidSession, botFromRequest, botDisplayName, SESSION_COOKIE } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** Who the current session is: a Google rep, a bot, the shared team passcode, or nobody. */
export async function GET(req: NextRequest) {
  const cookie = req.cookies.get(SESSION_COOKIE)?.value;
  const named = parseGoogleSession(cookie);
  if (named) return NextResponse.json({ ok: true, kind: named.bot ? "bot" : "google", name: named.name, email: named.email });
  const bot = botFromRequest(req);
  if (bot) return NextResponse.json({ ok: true, kind: "bot", name: botDisplayName(bot), via: "key" });
  if (isValidSession(cookie)) return NextResponse.json({ ok: true, kind: "team", name: "Team" });
  return NextResponse.json({ ok: false }, { status: 401 });
}
