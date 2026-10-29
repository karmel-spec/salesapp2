import { NextRequest, NextResponse } from "next/server";
import { botFromToken, botSessionToken, botDisplayName, SESSION_COOKIE } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * One-click sign-in for the Grok Bot admin team (Brigham 10/29):
 *   GET /api/auth/bot?token=<bot token>[&next=/leads/abc]
 * sets the bot's named 90-day session cookie and lands on `next` (same-site
 * paths only). No form, no Google, nothing to type — a bookmark is enough.
 * Also stores the bot's display name for the "Who are you?" attribution.
 */
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token") || "";
  const slug = botFromToken(token);
  if (!slug) {
    return new NextResponse(
      `<!doctype html><body style="font-family:sans-serif;padding:40px"><h2>Bot sign-in link not recognized</h2><p>The link is wrong, or this bot has been removed. Ask Brigham for a fresh link from the Sales App's Bot access page.</p><p><a href="/login">Back to login</a></p></body>`,
      { status: 403, headers: { "Content-Type": "text/html" } }
    );
  }
  const rawNext = req.nextUrl.searchParams.get("next") || "/";
  const next = rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/";
  const name = botDisplayName(slug);
  const html = `<!doctype html><body style="font-family:sans-serif;padding:40px"><p>Signing in ${name}…</p><script>
    try { localStorage.setItem("blp_rep_name", ${JSON.stringify(name)}); } catch (e) {}
    location.replace(${JSON.stringify(next)});
  </script><noscript><a href="${next}">Continue</a></noscript></body>`;
  const res = new NextResponse(html, { headers: { "Content-Type": "text/html", "Cache-Control": "no-store" } });
  res.cookies.set(SESSION_COOKIE, botSessionToken(slug), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 60 * 60 * 24 * 90, path: "/" });
  return res;
}
