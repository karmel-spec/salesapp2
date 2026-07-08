import { createTransport } from "nodemailer";
import { config } from "./config";

/** Outbound comms: Twilio SMS + SMTP email, both env-gated. */

export async function sendSms(to: string, body: string): Promise<{ sid: string }> {
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
      body: new URLSearchParams({ To: to, From: config.twilioFrom, Body: body }),
    }
  );
  const json = (await res.json()) as any;
  if (!res.ok) throw new Error(`Twilio send failed (${res.status}): ${json.message || "unknown"}`);
  return { sid: json.sid };
}

export async function sendEmail(
  to: string,
  subject: string,
  body: string
): Promise<{ messageId: string }> {
  if (!config.smtpPass) {
    throw new Error("Email not configured: set SMTP_PASS (app password for info@brighamlarsonpianos.com)");
  }
  const transport = createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    secure: config.smtpPort === 465,
    auth: { user: config.smtpUser, pass: config.smtpPass },
  });
  const html = body
    .split(/\n{2,}/)
    .map((p) => `<p>${p.replace(/\n/g, "<br/>")}</p>`)
    .join("");
  const info = await transport.sendMail({
    from: `"${config.emailFromName}" <${config.smtpUser}>`,
    to,
    subject,
    text: body,
    html,
  });
  return { messageId: info.messageId };
}
