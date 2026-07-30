import crypto from "crypto";
import { NextRequest, NextResponse, after } from "next/server";
import { getLeads, getLead, appendTimeline, type Lead } from "@/lib/leads";
import { addUnfiled } from "@/lib/plaud-unfiled";
import { uploadObject, publicUrl, storageConfigured } from "@/lib/supastore";
import { whisperTranscribe, summarizeCall, transcriptionConfigured } from "@/lib/transcribe";
import { autoFolder } from "@/lib/folders";
import { notifyTelegram } from "@/lib/arnold";
import { config } from "@/lib/config";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Twilio recordingStatusCallback: a bridged (outbound) or forwarded
 * (inbound) call finished recording. Pipeline (all after the 200 so Twilio
 * never retries): download the audio → archive to Supabase (permanent
 * link) → Whisper transcript → Claude summary → file onto the lead's
 * conversation (matched by leadId for app-dialed calls, else by phone
 * number) or into the Dashboard's unfiled queue.
 */

function validSignature(url: string, params: URLSearchParams, signature: string | null): boolean {
  if (!config.twilioAuthToken) return true; // unconfigured dev fallback
  if (!signature) return false;
  const data =
    url +
    [...params.keys()]
      .sort()
      .map((k) => k + params.get(k))
      .join("");
  const expected = crypto.createHmac("sha1", config.twilioAuthToken).update(data).digest("base64");
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function twilioGet(path: string): Promise<any> {
  const res = await fetch(`https://api.twilio.com${path}`, {
    headers: {
      Authorization:
        "Basic " + Buffer.from(`${config.twilioAccountSid}:${config.twilioAuthToken}`).toString("base64"),
    },
  });
  if (!res.ok) throw new Error(`Twilio API ${path} failed (${res.status})`);
  return res.json();
}

export async function POST(req: NextRequest) {
  const raw = await req.text();
  const params = new URLSearchParams(raw);
  const url = `${config.publicBaseUrl}/api/twilio/recording${req.nextUrl.search}`;
  if (!validSignature(url, params, req.headers.get("x-twilio-signature"))) {
    return NextResponse.json({ error: "Invalid Twilio signature" }, { status: 403 });
  }

  const status = params.get("RecordingStatus");
  const recordingSid = params.get("RecordingSid") || "";
  const recordingUrl = params.get("RecordingUrl") || "";
  const callSid = params.get("CallSid") || "";
  const durationSec = Number(params.get("RecordingDuration")) || null;
  const leadIdHint = req.nextUrl.searchParams.get("leadId") || "";
  const direction = (req.nextUrl.searchParams.get("direction") || "outbound") as "outbound" | "inbound";

  if (status !== "completed" || !recordingSid || !recordingUrl) {
    return NextResponse.json({ ok: true, ignored: status });
  }

  after(async () => {
    try {
      // 1. Pull the audio from Twilio and park it permanently.
      const audioRes = await fetch(`${recordingUrl}.mp3`, {
        headers: {
          Authorization:
            "Basic " + Buffer.from(`${config.twilioAccountSid}:${config.twilioAuthToken}`).toString("base64"),
        },
      });
      if (!audioRes.ok) throw new Error(`recording download failed (${audioRes.status})`);
      const audio = Buffer.from(await audioRes.arrayBuffer());
      let audioUrl = "";
      if (storageConfigured()) {
        const objectPath = `call-audio/twilio-${recordingSid}.mp3`;
        await uploadObject("blp-media", objectPath, audio, "audio/mpeg");
        audioUrl = publicUrl("blp-media", objectPath);
      }

      // 2. Whose call was this?
      let lead: Lead | undefined;
      let otherParty = "";
      if (leadIdHint) {
        lead = (await getLead(leadIdHint, true))?.lead;
      }
      if (!lead) {
        const call = await twilioGet(
          `/2010-04-01/Accounts/${config.twilioAccountSid}/Calls/${callSid}.json`
        ).catch(() => null);
        otherParty = (direction === "inbound" ? call?.from : call?.to) || "";
        const digits = otherParty.replace(/\D/g, "").slice(-10);
        if (digits.length === 10) {
          const { leads } = await getLeads(true);
          const matches = leads.filter((l) => l.phoneDialable.endsWith(digits));
          lead =
            matches.find((l) => l.statusBucket === "new" || l.statusBucket === "active") ||
            matches.sort((a, b) => (b.lastTouchISO || "").localeCompare(a.lastTouchISO || ""))[0];
        }
      }

      // 3. Transcribe + summarize (best-effort, key-gated).
      const mins = durationSec ? Math.round(durationSec / 60) : null;
      let transcript = "";
      let summary = "";
      if (transcriptionConfigured()) {
        try {
          transcript = await whisperTranscribe(audio, `${recordingSid}.mp3`);
        } catch (e) {
          console.error("whisper:", e);
        }
      }
      if (transcript) {
        try {
          summary = await summarizeCall(transcript, {
            leadName: lead?.name || otherParty || "the caller",
            direction,
            durationSec,
          });
        } catch (e) {
          console.error("summary:", e);
        }
      }

      const title = `${direction === "inbound" ? "Incoming" : "Outbound"} recorded call${mins ? ` (${mins} min)` : ""}`;
      const bodyText =
        (summary ? `${summary}\n` : "") +
        (transcript ? `\nTranscript excerpt: ${transcript.slice(0, 400)}${transcript.length > 400 ? "…" : ""}\n` : "") +
        `(Twilio recording ${recordingSid}${transcript ? "" : transcriptionConfigured() ? " — transcript failed" : " — add OPENAI_API_KEY for transcripts"})` +
        (audioUrl ? `\n🎧 Audio: ${audioUrl}` : "");

      if (lead) {
        const found = await getLead(lead.id, true);
        if (found) {
          await appendTimeline(
            found.lead,
            found.shape,
            {
              at: new Date().toISOString(),
              who: "Phone",
              kind: "call",
              folder: autoFolder(found.lead.leadType, found.lead.headline, `${summary} ${transcript.slice(0, 500)}`),
              text: `📞 ${title} — "${found.lead.name}":\n${bodyText}`,
            },
            { touchLastContact: true }
          );
          notifyTelegram(
            `📞 <b>Recorded ${direction} call filed</b> → ${found.lead.name}${mins ? ` · ${mins} min` : ""}\n${(summary || "Transcript pending.").slice(0, 300)}`
          ).catch(() => {});
          return;
        }
      }

      // No lead matched — queue it for two-click filing on the Dashboard.
      await addUnfiled({
        recordingId: `twilio-${recordingSid}`,
        startedAt: new Date().toISOString(),
        title: `${title}${otherParty ? ` — ${otherParty}` : ""}`,
        durationSec,
        summary: summary || transcript.slice(0, 1200) || "No transcript available — listen to the audio.",
        transcriptExcerpt: transcript.slice(0, 6000),
        audioUrl,
      });
      notifyTelegram(
        `📞 <b>Recorded ${direction} call with no matching lead</b>${otherParty ? ` (${otherParty})` : ""}${mins ? ` · ${mins} min` : ""}\n` +
          `${(summary || "").slice(0, 250)}\n→ File it from the Dashboard's "Unfiled call recordings" card.`
      ).catch(() => {});
    } catch (e) {
      console.error("recording pipeline:", e);
    }
  });

  return NextResponse.json({ ok: true });
}
