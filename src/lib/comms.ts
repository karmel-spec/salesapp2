import { createTransport } from "nodemailer";
import { config } from "./config";

/** Outbound comms: Twilio SMS + SMTP email, both env-gated.
 * In open/dev mode (no team passcode) sends are DRY-RUN by default —
 * logged, never delivered — so local development can't text customers. */

export async function sendSms(to: string, body: string): Promise<{ sid: string }> {
  if (config.dryRunSends) {
    console.log(`[DRY-RUN] SMS to ${to}: ${body.slice(0, 120)}`);
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
      body: new URLSearchParams({
        To: to,
        From: config.twilioFrom,
        Body: body,
        // Route through the A2P-registered service for opt-out compliance;
        // From pins the branded number (it's in the service's pool).
        ...(config.twilioMessagingServiceSid
          ? { MessagingServiceSid: config.twilioMessagingServiceSid }
          : {}),
      }),
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
export async function startBridgeCall(repPhone: string, leadPhone: string): Promise<{ sid: string }> {
  if (config.dryRunSends) {
    console.log(`[DRY-RUN] bridge call ${repPhone} → ${leadPhone}`);
    return { sid: "DRYRUN-CALL" };
  }
  if (!config.twilioAccountSid || !config.twilioAuthToken) {
    throw new Error("Twilio not configured: set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN");
  }
  const esc = (s: string) => s.replace(/[<>&"']/g, "");
  const twiml =
    `<Response><Say>Connecting you to the customer now.</Say>` +
    `<Dial callerId="${esc(config.twilioCallerId)}" timeout="25">${esc(leadPhone)}</Dial></Response>`;
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

export async function sendEmail(
  to: string,
  subject: string,
  body: string
): Promise<{ messageId: string }> {
  if (config.dryRunSends) {
    console.log(`[DRY-RUN] email to ${to} ("${subject}"): ${body.slice(0, 120)}`);
    return { messageId: "DRYRUN-EMAIL" };
  }
  if (!config.smtpPass) {
    throw new Error("Email not configured: set SMTP_PASS (app password for info@brighamlarsonpianos.com)");
  }
  const transport = createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    secure: config.smtpPort === 465,
    auth: { user: config.smtpUser, pass: config.smtpPass },
  });
  const info = await transport.sendMail({
    from: `"${config.emailFromName}" <${config.smtpUser}>`,
    to,
    subject,
    text: emailText(body),
    html: emailHtml(body),
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
