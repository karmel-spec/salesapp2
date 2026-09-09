import { createTransport } from "nodemailer";
import { config } from "./config";

/** Outbound comms: Twilio SMS + SMTP email, both env-gated.
 * In open/dev mode (no team passcode) sends are DRY-RUN by default —
 * logged, never delivered — so local development can't text customers. */

export async function sendSms(to: string, body: string, mediaUrls: string[] = []): Promise<{ sid: string }> {
  if (config.dryRunSends) {
    console.log(`[DRY-RUN] SMS to ${to}: ${body.slice(0, 120)}${mediaUrls.length ? ` +${mediaUrls.length} media` : ""}`);
    return { sid: "DRYRUN-SMS" };
  }
  if (!config.twilioAccountSid || !config.twilioAuthToken || !config.twilioFrom) {
    throw new Error(
      "Twilio not configured: set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER"
    );
  }
  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${config.twilioAccountSid}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization:
          "Basic " +
          Buffer.from(`${config.twilioAccountSid}:${config.twilioAuthToken}`).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: (() => {
        const params = new URLSearchParams({
          To: to,
          From: config.twilioFrom,
          Body: body,
          // Route through the A2P-registered service for opt-out compliance;
          // From pins the branded number (it's in the service's pool).
          ...(config.twilioMessagingServiceSid
            ? { MessagingServiceSid: config.twilioMessagingServiceSid }
            : {}),
        });
        // MMS: each photo is a repeated MediaUrl form field.
        for (const url of mediaUrls) params.append("MediaUrl", url);
        return params;
      })(),
    }
  );
  const json = (await res.json()) as any;
  if (!res.ok) throw new Error(`Twilio send failed (${res.status}): ${json.message || "unknown"}`);
  return { sid: json.sid };
}

/**
 * Bridge call: ring the rep's phone first (displaying the store number);
 * when they answer, dial the customer with the store number as caller ID.
 * Inline TwiML — no webhook endpoint required.
 */
export async function startBridgeCall(
  repPhone: string,
  leadPhone: string,
  opts: { leadId?: string } = {}
): Promise<{ sid: string }> {
  if (config.dryRunSends) {
    console.log(`[DRY-RUN] bridge call ${repPhone} → ${leadPhone} (recorded, lead ${opts.leadId || "?"})`);
    return { sid: "DRYRUN-CALL" };
  }
  if (!config.twilioAccountSid || !config.twilioAuthToken) {
    throw new Error("Twilio not configured: set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN");
  }
  const esc = (s: string) => s.replace(/[<>&"']/g, "");
  // Recording: dual-channel from answer; the customer hears the consent
  // announcement (whisper leg → /api/twilio/consent) before joining, and
  // the finished recording lands at /api/twilio/recording for archive +
  // transcript + summary + filing.
  const cb = `${config.publicBaseUrl}/api/twilio/recording?direction=outbound${opts.leadId ? `&amp;leadId=${encodeURIComponent(opts.leadId)}` : ""}`;
  const twiml =
    `<Response><Say>Connecting you to the customer now. This call is recorded for quality purposes.</Say>` +
    `<Dial callerId="${esc(config.twilioCallerId)}" timeout="25" record="record-from-answer-dual" ` +
    `recordingStatusCallback="${cb}" recordingStatusCallbackEvent="completed">` +
    `<Number url="${esc(config.publicBaseUrl)}/api/twilio/consent">${esc(leadPhone)}</Number>` +
    `</Dial></Response>`;
  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${config.twilioAccountSid}/Calls.json`,
    {
      method: "POST",
      headers: {
        Authorization:
          "Basic " +
          Buffer.from(`${config.twilioAccountSid}:${config.twilioAuthToken}`).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: repPhone, From: config.twilioCallerId, Twiml: twiml }),
    }
  );
  const json = (await res.json()) as any;
  if (!res.ok) throw new Error(`Twilio call failed (${res.status}): ${json.message || "unknown"}`);
  return { sid: json.sid };
}

export interface EmailAttachment {
  filename: string;
  contentType: string;
  content: Buffer;
}

/**
 * Per-rep sender identity. A rep with SMTP_USER_<REP> + SMTP_PASS_<REP>
 * (Gmail app password) sends AS THEMSELVES — replies land in their own
 * inbox (and the reply watcher mirrors them to the lead's timeline).
 * Everyone else sends from the shared info@ identity.
 */
export function senderFor(who: string): { user: string; pass: string; fromName: string } {
  const slug = (who || "").trim().toUpperCase().replace(/[^A-Z]/g, "");
  const user = slug ? process.env[`SMTP_USER_${slug}`] : undefined;
  const pass = slug ? process.env[`SMTP_PASS_${slug}`] : undefined;
  if (user && pass) {
    const fromName = process.env[`SMTP_NAME_${slug}`] || `${who.trim()} Larson`;
    return { user, pass, fromName };
  }
  return { user: config.smtpUser, pass: config.smtpPass, fromName: config.emailFromName };
}

export async function sendEmail(
  to: string,
  subject: string,
  body: string,
  attachments: EmailAttachment[] = [],
  trackPixelUrl = "", // 1×1 open-tracking pixel appended to the HTML part
  who = "" // rep name — picks the sender identity (see senderFor)
): Promise<{ messageId: string }> {
  const sender = senderFor(who);
  if (config.dryRunSends) {
    console.log(`[DRY-RUN] email to ${to} from ${sender.user} ("${subject}"): ${body.slice(0, 120)}${attachments.length ? ` +${attachments.length} attachment(s)` : ""}`);
    return { messageId: "DRYRUN-EMAIL" };
  }
  if (!sender.pass) {
    throw new Error("Email not configured: set SMTP_PASS (app password for info@brighamlarsonpianos.com)");
  }
  const transport = createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    secure: config.smtpPort === 465,
    auth: { user: sender.user, pass: sender.pass },
  });
  const info = await transport.sendMail({
    from: `"${sender.fromName}" <${sender.user}>`,
    to,
    subject,
    text: emailText(body),
    html:
      emailHtml(body) +
      (trackPixelUrl
        ? `<img src="${trackPixelUrl}" width="1" height="1" alt="" style="display:none;max-height:1px;max-width:1px;" />`
        : ""),
    ...(attachments.length
      ? { attachments: attachments.map((a) => ({ filename: a.filename, content: a.content, contentType: a.contentType })) }
      : {}),
  });
  return { messageId: info.messageId };
}

const MD_LINK = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;

/** Drop Shopify search-tracking params (?_pos, _sid, _ss) from product URLs. */
function cleanUrl(url: string): string {
  return url
    .replace(/([?&])_(pos|sid|ss)=[^&]*/g, "$1")
    .replace(/[?&]+$/, "")
    .replace(/\?&+/, "?")
    .replace(/&{2,}/g, "&");
}

/**
 * Render a plain-text draft as email HTML: markdown links `[label](url)`
 * become anchors, paragraphs and line breaks are preserved, everything
 * else is escaped.
 */
export function emailHtml(body: string): string {
  const escape = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const renderParagraph = (p: string) => {
    let out = "";
    let last = 0;
    for (const m of p.matchAll(MD_LINK)) {
      out += escape(p.slice(last, m.index));
      out += `<a href="${escape(cleanUrl(m[2]))}">${escape(m[1])}</a>`;
      last = m.index + m[0].length;
    }
    out += escape(p.slice(last));
    return out.replace(/\n/g, "<br/>");
  };
  return body
    .split(/\n{2,}/)
    .map((p) => `<p>${renderParagraph(p)}</p>`)
    .join("");
}

/** Plain-text MIME fallback: `[label](url)` → `label (url)`. */
export function emailText(body: string): string {
  return body.replace(MD_LINK, (_m, label, url) => `${label} (${cleanUrl(url)})`);
}
