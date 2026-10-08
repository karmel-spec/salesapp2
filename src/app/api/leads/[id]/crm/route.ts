import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/api";
import { getLead, mirrorCrmContact } from "@/lib/leads";
import { CRM_URL, CRM_KEY, type CrmCard } from "@/lib/crm";
export const dynamic = "force-dynamic";

/** Which CRM client is this lead? Lookup only (by blp_id, then email, then phone); never creates.
 *  A hit also refreshes this lead's sheet mirror from the CRM card, so a
 *  correction made in the CRM shows up in lists/search/map, not just here. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = requireSession(req); if (guard) return guard;
  const { id } = await ctx.params; const found = await getLead(id);
  if (!found) return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  const l = found.lead;
  const tries = [l.id && !l.id.startsWith("row-") ? `blp_id=${encodeURIComponent(l.id)}` : "", l.emailClean || l.email ? `email=${encodeURIComponent(l.emailClean || l.email)}` : "", l.phoneDialable ? `phone=${encodeURIComponent(l.phoneDialable)}` : ""].filter(Boolean);
  for (const q of tries) {
    try {
      const r = await fetch(`${CRM_URL}/api/clients/resolve?${q}`, { headers: { "x-blp-key": CRM_KEY }, cache: "no-store" });
      if (r.status === 403) { console.warn("[crm] resolve 403 — BLP_INTEGRATION_KEY mismatch with the CRM"); break; }
      if (r.ok) {
        const j = (await r.json()) as { id: number; client: CrmCard };
        const synced = await mirrorCrmContact(l.id, j.client).catch(() => [] as string[]);
        return NextResponse.json({ linked: true, id: j.id, url: `${CRM_URL}/clients?id=${j.id}`, client: j.client, synced });
      }
    } catch { /* try the next key */ }
  }
  return NextResponse.json({ linked: false });
}
