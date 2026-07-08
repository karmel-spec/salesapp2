import { NextRequest, NextResponse } from "next/server";

/**
 * Gate all pages and APIs behind the team passcode session cookie.
 * Exceptions: /login, the login API, and Arnold's draft webhook (which
 * authenticates itself with the draft-only key + HMAC).
 */
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const open =
    pathname === "/login" ||
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/api/arnold/draft") ||
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico";
  if (open) return NextResponse.next();

  // If no passcode is configured the app runs open (local dev) — the check
  // itself happens server-side in the routes; here we only redirect pages.
  const hasSession = Boolean(req.cookies.get("blp_session")?.value);
  const isApi = pathname.startsWith("/api/");
  if (!hasSession && !isApi && process.env.BLP_APP_ACCESS_KEY) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
