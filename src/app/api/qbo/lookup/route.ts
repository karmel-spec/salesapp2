import { NextRequest, NextResponse } from "next/server";
import { requireSession, jsonError } from "@/lib/api";
import { isValidArnoldKey } from "@/lib/auth";
import { qboConfigured, qboConnected, searchCustomers, customerInvoices, customerPayments } from "@/lib/qbo";

export const dynamic = "force-dynamic";
export const maxDuration = 26;

const INTEGRATION_KEY = process.env.BLP_INTEGRATION_KEY || process.env.BLP_APP_ACCESS_KEY || "";
const keyOk = (v: string | null) => Boolean(v && ((INTEGRATION_KEY && v === INTEGRATION_KEY) || isValidArnoldKey(v)));

/**
 * Read-only QuickBooks lookup for admin-side agents (Clara, Lindsay) and the console.
 * GET ?q=<name or email>[&invoices=1&payments=1]  — session cookie, or x-blp-key (integration key / Arnold key).
 * Never creates, updates or sends anything in QuickBooks.
 */
export async function GET(req: NextRequest) {
  if (!keyOk(req.headers.get("x-blp-key"))) { const guard = requireSession(req); if (guard) return guard; }
  try {
    const qstr = (req.nextUrl.searchParams.get("q") || "").trim();
    if (!qstr) return NextResponse.json({ error: "q (customer name or email) required" }, { status: 400 });
    if (!qboConfigured()) return NextResponse.json({ configured: false, connected: false, hint: "QuickBooks isn't linked to the sales app yet (QBO_CLIENT_ID/QBO_CLIENT_SECRET, then /api/qbo/connect)." });
    const c = await qboConnected();
    if (!c.connected) return NextResponse.json({ configured: true, connected: false, hint: "QuickBooks is configured but not connected — a signed-in admin needs to open /api/qbo/connect once." });
    const customers = await searchCustomers(qstr, 8);
    const wantInv = req.nextUrl.searchParams.get("invoices") !== "0";
    const wantPay = req.nextUrl.searchParams.get("payments") === "1";
    const detail = customers.length === 1 || req.nextUrl.searchParams.get("all") === "1" ? customers : customers.slice(0, 1);
    const results = [];
    for (const cu of detail) {
      results.push({ customer: cu, invoices: wantInv ? await customerInvoices(cu.id) : undefined, payments: wantPay ? await customerPayments(cu.id) : undefined });
    }
    return NextResponse.json({ configured: true, connected: true, matches: customers, results });
  } catch (err) {
    return jsonError(err);
  }
}
