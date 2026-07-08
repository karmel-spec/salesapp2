import crypto from "crypto";
import Anthropic from "@anthropic-ai/sdk";
import { config } from "./config";
import type { Lead, DraftMessage } from "./leads";

/**
 * Arnold — Chief Sales Agent for Brigham Larson Pianos.
 *
 * Three integration paths, used in this order:
 *  1. Hermes webhook (ARNOLD_WEBHOOK_URL + HMAC secret): the app pings
 *     Arnold's gateway; Arnold works the lead and POSTs drafts back to
 *     /api/arnold/draft using his draft-only key.
 *  2. Telegram: humans chat with Arnold directly at t.me/arnoldlarsonbot;
 *     the app can post team notifications via the bot API.
 *  3. Claude API fallback (ANTHROPIC_API_KEY): the app generates drafts in
 *     Arnold's voice directly, so the approval queue works even when the
 *     Hermes gateway is unreachable.
 */

export const ARNOLD_TELEGRAM_URL = "https://t.me/arnoldlarsonbot";

export function hmacSign(body: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(body).digest("hex");
}

export function hmacVerify(body: string, signature: string | null, secret: string): boolean {
  if (!secret || !signature) return false;
  const expected = hmacSign(body, secret);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Ping Arnold's Hermes gateway (e.g. ask him to draft outreach for a lead). */
export async function notifyArnoldWebhook(payload: {
  event: string;
  lead?: Partial<Lead>;
  note?: string;
}): Promise<{ ok: boolean; detail: string }> {
  if (!config.arnoldWebhookUrl) {
    return { ok: false, detail: "ARNOLD_WEBHOOK_URL not configured" };
  }
  const body = JSON.stringify({
    ...payload,
    // Top-level leadId + channel match the shape Arnold's handler already knows.
    leadId: payload.lead?.id,
    channel: "auto",
    source: "blp-sales-app",
    at: new Date().toISOString(),
  });
  const res = await fetch(config.arnoldWebhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // Hermes validates GitHub-style HMAC signatures.
      "X-Hub-Signature-256": `sha256=${hmacSign(body, config.arnoldWebhookSecret)}`,
    },
    body,
  });
  return { ok: res.ok, detail: res.ok ? "Arnold pinged" : `Arnold webhook ${res.status}` };
}

/** Team notification via Arnold's Telegram bot. */
export async function notifyTelegram(text: string): Promise<{ ok: boolean; detail: string }> {
  if (!config.telegramBotToken || !config.telegramChatId) {
    return { ok: false, detail: "TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID not configured" };
  }
  const res = await fetch(`https://api.telegram.org/bot${config.telegramBotToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: config.telegramChatId, text, parse_mode: "HTML" }),
  });
  return { ok: res.ok, detail: res.ok ? "Telegram sent" : `Telegram ${res.status}` };
}

const DRAFT_SCHEMA = {
  type: "object" as const,
  properties: {
    sms: {
      type: "string",
      description: "Text message draft, under 320 characters, warm and personal",
    },
    emailSubject: { type: "string", description: "Email subject line" },
    emailBody: {
      type: "string",
      description: "Email body in plain text, 2-4 short paragraphs, signed 'Brigham Larson Pianos'",
    },
    reasoning: { type: "string", description: "One sentence on the suggested approach" },
  },
  required: ["sms", "emailSubject", "emailBody", "reasoning"],
  additionalProperties: false as const,
};

/**
 * Fallback draft generation via the Claude API, writing in Arnold's voice.
 * Only used when ANTHROPIC_API_KEY is set and Arnold's webhook isn't.
 */
export async function generateDraftsViaApi(lead: Lead): Promise<{
  drafts: DraftMessage[];
  reasoning: string;
}> {
  if (!config.anthropicApiKey) {
    throw new Error("ANTHROPIC_API_KEY not configured and Arnold webhook unavailable");
  }
  const client = new Anthropic({ apiKey: config.anthropicApiKey });

  const context = [
    `Customer: ${lead.name}`,
    `Headline: ${lead.headline || "(none)"}`,
    `Type of lead: ${lead.leadType || "unknown"} | Piano: ${lead.pianoType || "unknown"}`,
    `Source: ${lead.source || "unknown"} | Inquiry method: ${lead.inquiryMethod || "unknown"}`,
    `Days since last contact: ${lead.daysSinceContact ?? "unknown"}`,
    `Assigned rep: ${lead.effectiveRep}`,
    `Notes: ${(lead.notes || "").slice(0, 1500)}`,
    `Activity so far: ${(lead.activityTimeline || "").slice(0, 2500)}`,
  ].join("\n");

  const response = await client.messages.create({
    model: "claude-opus-4-8",
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    system:
      "You are Arnold, Chief Sales Agent at Brigham Larson Pianos in Utah. You draft warm, low-pressure, " +
      "genuinely helpful follow-up messages to piano customers — restoration, sales, lessons, and service leads. " +
      "You sound like a friendly Utah piano shop, never like a pushy salesperson or an AI. Reference the specific " +
      "piano or situation from the lead's history. Suggest one concrete next step (a call, an in-home evaluation, " +
      "a shop visit). Keep texts short and casual; keep emails brief and skimmable. In EMAILS, write links as " +
      "markdown — [1905 Steinway Upright](https://…) — with the piano name as the label, never a raw URL, and " +
      "strip tracking query params. Never use markdown links in texts (SMS is plain text). When a lead seems " +
      "ready to talk (hot, complex restoration, asking questions), suggest booking a call with Brigham: in " +
      "emails link [grab a time on Brigham's calendar](https://calendly.com/BrighamLarson); in texts say " +
      "'you can grab a time with Brigham at calendly.com/BrighamLarson'.",
    messages: [
      {
        role: "user",
        content: `Draft the next-contact outreach (one SMS and one email) for this lead:\n\n${context}`,
      },
    ],
    // Low effort: drafts are short, and this keeps generation inside
    // Netlify's synchronous function timeout.
    output_config: { effort: "low", format: { type: "json_schema", schema: DRAFT_SCHEMA } },
  });

  if (response.stop_reason === "refusal") {
    throw new Error("Draft generation was declined — write this one manually.");
  }
  const text = response.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") throw new Error("Draft generation returned no text");
  const parsed = JSON.parse(text.text) as {
    sms: string;
    emailSubject: string;
    emailBody: string;
    reasoning: string;
  };

  const now = new Date().toISOString();
  return {
    reasoning: parsed.reasoning,
    drafts: [
      { channel: "sms", body: parsed.sms, status: "pending", createdAt: now, createdBy: "arnold-api" },
      {
        channel: "email",
        subject: parsed.emailSubject,
        body: parsed.emailBody,
        status: "pending",
        createdAt: now,
        createdBy: "arnold-api",
      },
    ],
  };
}
