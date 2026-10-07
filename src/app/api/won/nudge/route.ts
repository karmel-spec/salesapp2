import { NextRequest, NextResponse } from "next/server";
import { requireSession, jsonError } from "@/lib/api";
import { config } from "@/lib/config";
import { sendEmail } from "@/lib/comms";
import { listHandoffs, patchHandoff, ackToken, handoffStoreReady, logHandoff, renderHandoff, todos } from "@/lib/won";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const TO = { admin: (process.env.WON_ADMIN_TO || "info@brighamlarsonpianos.com, melissa@brighamlarsonpianos.com"), shop: process.env.WON_SHOP_TO || "shop@brighamlarsonpianos.com" };

/** Every 30 min (Netlify cron with ?key=): handoffs unacknowledged 2h after sending get a reminder to whoever hasn't clicked, up to 3 times, 4h apart. */
export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key");
  if (key !== config.accessKey) { const guard = requireSession(req); if (guard) return guard; }
  try {
    if (!handoffStoreReady()) return NextResponse.json({ nudged: 0, reason: "store not configured" });
    const dry = req.nextUrl.searchParams.get("dry") === "1";
    const cutoff = new Date(Date.now() - 2 * 3600e3).toISOString();
    const since = new Date(Date.now() - 14 * 864e5).toISOString();
    const rows = await listHandoffs(`created_at=gte.${since}&email_sent_at=lte.${cutoff}&nudge_count=lt.3&or=(admin_ack_at.is.null,shop_ack_at.is.null)&order=created_at.asc`);
    const out: { id: string; to: string[] }[] = [];
    for (const r of rows) {
      if (r.nudged_at && Date.now() - Date.parse(r.nudged_at) < 4 * 3600e3) continue;
      const roles: ("admin" | "shop")[] = [];
      if (!r.admin_ack_at) roles.push("admin");
      if (!r.shop_ack_at && todos(r.answers).shop.length) roles.push("shop");
      if (!roles.length) continue;
      const to = roles.map((x) => TO[x]).join(", ");
      if (!dry) {
        const ack: Record<string, string> = {};
        for (const role of roles) ack[role === "admin" ? "ackAdmin" : "ackShop"] = `${config.publicBaseUrl}/api/won/ack?id=${r.id}&role=${role}&t=${await ackToken(r.id, role)}`;
        const mail = renderHandoff(r.answers, { name: r.lead_name, email: r.client_email || undefined, phone: r.client_phone || undefined }, { lead: `${config.publicBaseUrl}/leads/${encodeURIComponent(r.lead_id)}`, portal: r.portal_project_id ? `${process.env.CLIENT_PORTAL_URL || "https://blpclientportal.netlify.app"}/admin/projects/${r.portal_project_id}` : undefined, qbo: r.qbo_invoice_url || undefined, ...ack });
        const hours = Math.round((Date.now() - Date.parse(r.email_sent_at!)) / 3600e3);
        try {
          await sendEmail(to, `Reminder ${r.nudge_count + 1}: ${mail.subject}`, `Nobody has pressed "Got it, I'm on it" for this handoff yet (sent ${hours}h ago). Please take a look and acknowledge so ${r.closed_by || "the rep"} knows it's covered.\n\n${mail.body}`);
          await patchHandoff(r.id, { nudged_at: new Date().toISOString(), nudge_count: r.nudge_count + 1 });
          await logHandoff(r, `Reminder ${r.nudge_count + 1} sent to ${roles.join(" + ")}`);
        } catch (e) { await logHandoff(r, `Reminder failed: ${e instanceof Error ? e.message : String(e)}`, false); continue; }
      }
      out.push({ id: r.id, to: roles });
    }
    return NextResponse.json({ nudged: out.length, items: out, dry });
  } catch (err) {
    return jsonError(err);
  }
}
