import { NextRequest, NextResponse } from "next/server";
import { requireSession, jsonError } from "@/lib/api";
import { config } from "@/lib/config";
import { sendEmail } from "@/lib/comms";
import { isHoliday } from "@/lib/streak";
import { listHandoffs, patchHandoff, ackToken, handoffStoreReady, logHandoff, renderHandoff, todos, type HandoffRow } from "@/lib/won";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Who gets the reminder for each role (Brigham 10/8: melissa@ for admin, shop@ for the shop — not info@). */
const TO = { admin: process.env.WON_ADMIN_TO || "melissa@brighamlarsonpianos.com", shop: process.env.WON_SHOP_TO || "shop@brighamlarsonpianos.com" };
const DAY_MS = 24 * 3600e3;

/** Today's date in Mountain time as YYYY-MM-DD. */
function denverDay(d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Denver", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
/** Business day = Monday–Friday and not a holiday (the same holiday list the streaks use). */
function isBusinessDay(day: string): boolean {
  const [y, m, d] = day.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return dow >= 1 && dow <= 5 && !isHoliday(day);
}

/**
 * Daily (Netlify cron, business mornings; ?key=): each role that still hasn't pressed "Got it" gets ONE reminder
 * per 24 hours, business days only — never on weekends or holidays. A role that has acknowledged is never
 * emailed again, even while the other role is still outstanding. ?dry=1 previews.
 */
export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key");
  if (key !== config.accessKey) { const guard = requireSession(req); if (guard) return guard; }
  try {
    if (!handoffStoreReady()) return NextResponse.json({ nudged: 0, reason: "store not configured" });
    const dry = req.nextUrl.searchParams.get("dry") === "1";
    const today = denverDay();
    if (!isBusinessDay(today) && !dry) return NextResponse.json({ nudged: 0, reason: `${today} is not a business day` });
    const since = new Date(Date.now() - 45 * 864e5).toISOString();
    const rows = await listHandoffs(`status=eq.sent&created_at=gte.${since}&email_sent_at=not.is.null&or=(admin_ack_at.is.null,shop_ack_at.is.null)&order=created_at.asc`);
    const out: { id: string; name: string; to: string[] }[] = [];
    for (const r of rows as (HandoffRow & { admin_nudged_at: string | null; shop_nudged_at: string | null; admin_nudges: number; shop_nudges: number })[]) {
      const sentAt = Date.parse(r.email_sent_at!);
      const due = (role: "admin" | "shop") => {
        const acked = role === "admin" ? r.admin_ack_at : r.shop_ack_at;
        if (acked) return false; // acknowledged → never again
        if (role === "shop" && !todos(r.answers).shop.length && r.branch !== "shop") return false; // nothing for the shop on this one
        const last = Date.parse((role === "admin" ? r.admin_nudged_at : r.shop_nudged_at) || "") || sentAt;
        return Date.now() - last >= DAY_MS - 2 * 3600e3; // a full day since the send or the last reminder (2h slack for cron drift)
      };
      const roles = (["admin", "shop"] as const).filter(due);
      if (!roles.length) continue;
      if (!dry) {
        const base = { lead: `${config.publicBaseUrl}/leads/${encodeURIComponent(r.lead_id)}`, portal: r.portal_project_id ? `${process.env.CLIENT_PORTAL_URL || "https://blpclientportal.netlify.app"}/admin/projects/${r.portal_project_id}` : undefined };
        const days = Math.max(1, Math.round((Date.now() - sentAt) / DAY_MS));
        for (const role of roles) {
          try {
            const ackUrl = `${config.publicBaseUrl}/api/won/ack?id=${r.id}&role=${role}&t=${await ackToken(r.id, role)}`;
            const mail = renderHandoff(r.answers, { name: r.lead_name, email: r.client_email || undefined, phone: r.client_phone || undefined }, role === "admin" ? { ...base, qbo: r.qbo_invoice_url || undefined, ackAdmin: ackUrl } : { ...base, ackShop: ackUrl }, undefined, role);
            const n = (role === "admin" ? r.admin_nudges : r.shop_nudges) + 1;
            await sendEmail(TO[role], `Reminder: ${mail.subject}`, `This handoff was sent ${days} day${days === 1 ? "" : "s"} ago and hasn't been acknowledged yet. Please take a look and press "Got it, I'm on it" so ${r.closed_by || "the rep"} knows it's covered. (One reminder per business day until it's acknowledged.)\n\n${mail.body}`);
            await patchHandoff(r.id, role === "admin" ? { admin_nudged_at: new Date().toISOString(), admin_nudges: n } as Partial<HandoffRow> : { shop_nudged_at: new Date().toISOString(), shop_nudges: n } as Partial<HandoffRow>);
            await patchHandoff(r.id, { nudged_at: new Date().toISOString(), nudge_count: (r.nudge_count || 0) + 1 });
            await logHandoff(r, `Reminder ${n} sent to ${role} (${TO[role]})`);
          } catch (e) { await logHandoff(r, `Reminder to ${role} failed: ${e instanceof Error ? e.message : String(e)}`, false); }
        }
      }
      out.push({ id: r.id, name: r.lead_name, to: roles });
    }
    return NextResponse.json({ nudged: out.length, items: out, dry, day: today, businessDay: isBusinessDay(today) });
  } catch (err) {
    return jsonError(err);
  }
}
