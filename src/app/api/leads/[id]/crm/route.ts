import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/api";
import { getLead } from "@/lib/leads";
export const dynamic = "force-dynamic";
const CRM = process.env.CRM_URL || "https://blpcrm.netlify.app";
const KEY = process.env.BLP_INTEGRATION_KEY || process.env.BLP_APP_ACCESS_KEY || "pianoman";
/** Which CRM client is this lead? Lookup only (by blp_id, then email, then phone); never creates. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = requireSession(req); if (guard) return guard;
  const { id } = await ctx.params; const found = await getLead(id);
  if (!found) return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  const l = found.lead;
  const tries = [l.id && !l.id.startsWith("row-") ? `blp_id=${encodeURIComponent(l.id)}` : "", l.emailClean || l.email ? `email=${encodeURIComponent(l.emailClean || l.email)}` : "", l.phoneDialable ? `phone=${encodeURIComponent(l.phoneDialable)}` : ""].filter(Boolean);
  for (const q of tries) {
    try {
      const r = await fetch(`${CRM}/api/clients/resolve?${q}`, { headers: { "x-blp-key": KEY }, cache: "no-store" });
      if (r.ok) { const j = (await r.json()) as { id: number; client: Record<string, unknown> }; return NextResponse.json({ linked: true, id: j.id, url: `${CRM}/clients/${j.id}`, client: j.client }); }
    } catch { /* try the next key */ }
  }
  return NextResponse.json({ linked: false });
}
