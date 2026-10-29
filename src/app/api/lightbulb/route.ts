import { NextRequest, NextResponse } from "next/server";
import { isValidSession, parseGoogleSession, SESSION_COOKIE } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Session for the shared 💡 lightbulb widget (blpstoremap.netlify.app/lightbulb.js,
 * data-session="/api/lightbulb"): the signed-in person, whether they get the
 * Sales App's App Requests panel, and the team key the Store Map bridge checks
 * on every write. Passcode-only sessions carry no identity, so they get the key
 * but no name (the widget falls back to blp_rep_name) and no admin panel.
 * Admins = owners + office managers; LIGHTBULB_ADMINS (comma-separated emails)
 * replaces the list.
 */
const ADMINS = (process.env.LIGHTBULB_ADMINS ||
  "brigham@brighamlarsonpianos.com,karmel@brighamlarsonpianos.com,brighamlarson@gmail.com,melissa@brighamlarsonpianos.com,alisa@brighamlarsonpianos.com,susie@brighamlarsonpianos.com,walter@brighamlarsonpianos.com,markhales.blp@gmail.com")
  .split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);

export async function GET(req: NextRequest) {
  const cookie = req.cookies.get(SESSION_COOKIE)?.value;
  if (!isValidSession(cookie)) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const g = parseGoogleSession(cookie);
  const email = (g?.email || "").toLowerCase();
  return NextResponse.json(
    {
      name: g?.name || "",
      email,
      admin: !!email && ADMINS.includes(email),
      key: process.env.STOREMAP_BRIDGE_PIN || "pianoman",
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
