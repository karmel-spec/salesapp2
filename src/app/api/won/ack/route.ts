import { NextRequest, NextResponse } from "next/server";
import { getHandoff, patchHandoff, ackToken, logHandoff } from "@/lib/won";

export const dynamic = "force-dynamic";

const page = (title: string, body: string, ok = true) => new NextResponse(
  `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<body style="font-family:-apple-system,Segoe UI,sans-serif;background:#faf8f3;color:#1b1613;display:grid;place-items:center;min-height:100vh;margin:0;padding:20px">
<div style="max-width:440px;background:#fff;border:1px solid #e2d8c8;border-radius:14px;padding:26px 28px;text-align:center">
<div style="font-size:40px">${ok ? "✅" : "⚠️"}</div><h1 style="font-size:22px;margin:8px 0;color:#9E2020">${title}</h1><p style="margin:0;line-height:1.5">${body}</p></div></body>`,
  { status: ok ? 200 : 400, headers: { "content-type": "text/html; charset=utf-8" } }
);

/** "Got it, I'm on it" from the handoff email. ?id&role=admin|shop&t=<token>[&who=] */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const id = q.get("id") || "", role = q.get("role") === "shop" ? "shop" : q.get("role") === "admin" ? "admin" : null, t = q.get("t") || "";
  if (!id || !role) return page("Bad link", "This acknowledgment link is missing its id or role.", false);
  if (t !== (await ackToken(id, role))) return page("Link doesn't match", "This acknowledgment link isn't valid for that handoff.", false);
  const row = await getHandoff(id).catch(() => null);
  if (!row) return page("Handoff not found", "That handoff isn't in the system (it may predate this feature).", false);
  const who = (q.get("who") || "").slice(0, 60) || (role === "shop" ? "Shop manager" : "Admin");
  const already = role === "shop" ? row.shop_ack_at : row.admin_ack_at;
  if (already) return page("Already acknowledged", `${row.lead_name} — ${role === "shop" ? "the shop" : "admin"} acknowledged this handoff ${new Date(already).toLocaleString("en-US", { timeZone: "America/Denver" })}. Thank you!`);
  const now = new Date().toISOString();
  await patchHandoff(id, role === "shop" ? { shop_ack_at: now, shop_ack_by: who } : { admin_ack_at: now, admin_ack_by: who });
  await logHandoff(row, `${role === "shop" ? "Shop" : "Admin"} acknowledged (${who})`);
  return page("Got it — thank you!", `${row.lead_name}'s ${row.branch === "shop" ? "shop project" : "showroom sale"} is marked as in ${role === "shop" ? "the shop's" : "admin's"} hands. ${row.closed_by || "The rep"} can see it on the lead.`);
}
