import { NextRequest, NextResponse } from "next/server";
import { config } from "@/lib/config";
import { handleCallback } from "@/lib/qbo";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const code = q.get("code") || "", realmId = q.get("realmId") || "", state = q.get("state") || "";
  if (!code || !realmId) return NextResponse.json({ error: `Intuit returned no code/realmId (${q.get("error") || "cancelled"})` }, { status: 400 });
  if (state !== req.cookies.get("qbo_state")?.value) return NextResponse.json({ error: "State mismatch — start again from /api/qbo/connect" }, { status: 400 });
  try {
    await handleCallback(code, realmId, `${config.publicBaseUrl}/api/qbo/callback`);
    return new NextResponse(`<!doctype html><meta charset="utf-8"><body style="font-family:-apple-system,sans-serif;padding:40px;text-align:center"><h1 style="color:#9E2020">QuickBooks connected ✅</h1><p>Company ${realmId}. WON handoffs will now draft invoices in QBO. You can close this tab.</p></body>`, { headers: { "content-type": "text/html; charset=utf-8" } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
