import { NextRequest, NextResponse } from "next/server";
import { requireSession, jsonError } from "@/lib/api";
import { config } from "@/lib/config";
import { listHandoffs, getHandoff, logHandoff, pushShopScope, shopScopeLines, handoffStoreReady, SCOPE_DONE_RE, SCOPE_REVIEW_RE } from "@/lib/won";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const BRIDGE_URL = process.env.BLP_BRIDGE_URL || "https://script.google.com/macros/s/AKfycbxY4BKnr_Tr0iCTc9itCWhNYLvgszmkI1IoYSkbBWpyAqRtWI-yaUkJQjcVdgG58KXt/exec";
const BRIDGE_PIN = process.env.BLP_BRIDGE_PIN || "";

const authed = (req: NextRequest, key?: string | null) => key === config.accessKey || !requireSession(req);

/**
 * 🏆 Mark's review of WON shop-project card notes (Mark 10/21): the first 10
 * shop handoffs from 10/21 hold their fix requests / piano note until he says
 * what the techs should see.
 *   GET  ?key=…                      → {pending:[{id, lead, piano, serial, sold, lines}]}
 *   POST {key, id, lines: string[]}  → writes those lines to the piano card
 *                                      (empty array = nothing for the techs)
 * The morning Shop Manager Briefing lists the pending ones.
 */
export async function GET(req: NextRequest) {
  if (!authed(req, req.nextUrl.searchParams.get("key"))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    if (!handoffStoreReady()) return NextResponse.json({ pending: [] });
    const rows = await listHandoffs(`branch=eq.shop&status=eq.sent&order=created_at.asc&limit=200`);
    const pending = rows.filter((r) => {
      const log = r.log || [];
      return log.some((l) => SCOPE_REVIEW_RE.test(l.text)) && !log.some((l) => SCOPE_DONE_RE.test(l.text));
    }).map((r) => ({ id: r.id, lead: r.lead_name, piano: r.piano || r.answers?.piano?.label || "", serial: r.serial || "", sold: r.created_at, closer: r.closed_by, lines: shopScopeLines(r.answers, r.created_at).lines }));
    return NextResponse.json({ pending });
  } catch (err) { return jsonError(err); }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as { key?: string; id?: string; lines?: unknown; dry?: boolean };
    if (!authed(req, body.key)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const row = body.id ? await getHandoff(String(body.id)) : null;
    if (!row) return NextResponse.json({ error: "handoff not found" }, { status: 404 });
    const lines = Array.isArray(body.lines) ? body.lines.map((l) => String(l || "").trim()).filter(Boolean).slice(0, 12) : null;
    if (!lines) return NextResponse.json({ error: "lines (array) required — [] means nothing for the techs" }, { status: 400 });
    if (!lines.length) {
      if (!body.dry) await logHandoff(row, "Shop notes on the piano card — none (Mark reviewed: nothing the techs need)");
      return NextResponse.json({ ok: true, written: 0, dry: !!body.dry });
    }
    const res = await pushShopScope(row, { url: BRIDGE_URL, pin: BRIDGE_PIN }, !!body.dry, lines);
    if (!res.ok) return NextResponse.json({ ok: false, error: res.error }, { status: 409 });
    if (!body.dry) await logHandoff(row, `Shop notes on the piano card — Piano Log row ${res.row}${res.added ? ` (${res.added} line${res.added === 1 ? "" : "s"}, reviewed by Mark)` : " (already there)"}`);
    return NextResponse.json({ ok: true, row: res.row, added: res.added, adding: res.adding, dry: !!body.dry });
  } catch (err) { return jsonError(err); }
}
