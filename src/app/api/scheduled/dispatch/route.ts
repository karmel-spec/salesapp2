import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getLead, appendTimeline } from "@/lib/leads";
import { dueScheduled, updateScheduled } from "@/lib/scheduled";
import { sendSms, sendEmail, senderFor } from "@/lib/comms";
import { notifyTelegram } from "@/lib/arnold";
import { requireSession, jsonError } from "@/lib/api";
import { isValidArnoldKey } from "@/lib/auth";
import { config } from "@/lib/config";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Fire everything due. Pinged every 5 minutes by the LaunchAgent
 * com.blp.scheduled-sends (agent key), and callable from a session.
 * Each due message goes out through the normal pipeline: per-rep email
 * identity, open-tracking pixel, timeline event, Telegram ping.
 */
export async function POST(req: NextRequest) {
  const guard = requireSession(req);
  if (guard && !isValidArnoldKey(req.headers.get("x-blp-key"))) return guard;
  try {
    const due = await dueScheduled();
    const results: { id: string; status: string }[] = [];
    for (const item of due) {
      try {
        const found = await getLead(item.leadId, true);
        if (!found) throw new Error("lead no longer exists");
        const { lead, shape } = found;
        let deliveryNote: string;
        let trackId = "";
        if (item.channel === "sms") {
          if (!lead.phoneDialable) throw new Error(`no dialable phone ("${lead.phone}")`);
          const { sid } = await sendSms(lead.phoneDialable, item.body);
          deliveryNote = `SMS sent to ${lead.phoneDialable} (Twilio ${sid})`;
        } else {
          if (!lead.emailClean) throw new Error(`no valid email ("${lead.email}")`);
          trackId = crypto.randomBytes(12).toString("hex");
          const fromAddr = senderFor(item.sendAs).user;
          const { messageId } = await sendEmail(
            lead.emailClean,
            item.subject,
            item.body,
            [],
            `${config.publicBaseUrl}/api/track/${trackId}.gif`,
            item.sendAs
          );
          deliveryNote = `Email "${item.subject}" sent to ${lead.emailClean} from ${fromAddr} (${messageId})`;
        }
        await appendTimeline(
          lead,
          shape,
          {
            at: new Date().toISOString(),
            who: item.who,
            kind: item.channel === "sms" ? "sms_out" : "email_out",
            ...(trackId ? { trackId } : {}),
            text:
              item.channel === "email"
                ? `${deliveryNote} — scheduled by ${item.who}, sent automatically. Full message:\nSubject: ${item.subject}\n\n${item.body}`
                : `${deliveryNote} — scheduled by ${item.who}, sent automatically. Full message:\n${item.body}`,
          },
          { touchLastContact: true }
        );
        await updateScheduled(item.id, { status: "sent", sentAt: new Date().toISOString() });
        results.push({ id: item.id, status: "sent" });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await updateScheduled(item.id, { status: "failed", error: msg.slice(0, 300) });
        notifyTelegram(
          `⚠️ <b>Scheduled ${item.channel} to ${item.leadName} FAILED</b>: ${msg.slice(0, 200)}\n(scheduled by ${item.who} for ${item.sendAt})`
        ).catch(() => {});
        results.push({ id: item.id, status: "failed" });
      }
    }
    return NextResponse.json({ ok: true, dispatched: results });
  } catch (err) {
    return jsonError(err);
  }
}
