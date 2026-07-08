import { NextRequest, NextResponse } from "next/server";
import { checkPasscode, sessionToken, SESSION_COOKIE } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const { passcode } = (await req.json().catch(() => ({}))) as { passcode?: string };
  if (!checkPasscode(passcode || "")) {
    return NextResponse.json({ error: "Incorrect passcode" }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, sessionToken(), {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 30,
    path: "/",
  });
  return res;
}
