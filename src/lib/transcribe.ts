import { config } from "./config";

/**
 * Call transcription + summarization.
 *  - Transcript: OpenAI Whisper (OPENAI_API_KEY) — ~$0.006/min.
 *  - Summary: Claude (ANTHROPIC_API_KEY, already used for Arnold drafts).
 * Both steps are env-gated and best-effort: a missing key or a failure
 * never blocks the call from being logged with its audio link.
 */

const OPENAI_KEY = process.env.OPENAI_API_KEY || "";
const WHISPER_MAX_BYTES = 24_000_000; // API limit is 25MB — leave headroom

export function transcriptionConfigured(): boolean {
  return Boolean(OPENAI_KEY);
}

export async function whisperTranscribe(audio: Buffer, filename: string): Promise<string> {
  if (!OPENAI_KEY) throw new Error("OPENAI_API_KEY not set");
  const clipped = audio.length > WHISPER_MAX_BYTES;
  const payload = clipped ? audio.subarray(0, WHISPER_MAX_BYTES) : audio;
  const form = new FormData();
  const body = new ArrayBuffer(payload.length);
  new Uint8Array(body).set(payload);
  form.append("file", new Blob([body], { type: "audio/mpeg" }), filename);
  form.append("model", "whisper-1");
  form.append("response_format", "text");
  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_KEY}` },
    body: form,
  });
  if (!res.ok) throw new Error(`Whisper failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  const text = (await res.text()).trim();
  return clipped ? `${text}\n[transcript truncated — recording exceeded the 25MB transcription limit]` : text;
}

export async function summarizeCall(
  transcript: string,
  context: { leadName: string; direction: "outbound" | "inbound"; durationSec?: number | null }
): Promise<string> {
  if (!config.anthropicApiKey) throw new Error("ANTHROPIC_API_KEY not set");
  const mins = context.durationSec ? Math.round(context.durationSec / 60) : null;
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": config.anthropicApiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 400,
      messages: [
        {
          role: "user",
          content:
            `Summarize this ${mins ? `${mins}-minute ` : ""}${context.direction} phone call between Brigham Larson Pianos and ${context.leadName} ` +
            `for the sales team's activity log. 3-6 sentences: what the customer wants, key details (piano, budget, timing, address), ` +
            `decisions made, and the agreed next step. Plain text only.\n\nTRANSCRIPT:\n${transcript.slice(0, 100_000)}`,
        },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Claude summary failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as { content: { type: string; text?: string }[] };
  return (data.content.find((c) => c.type === "text")?.text || "").trim();
}
