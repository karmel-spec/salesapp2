#!/usr/bin/env node
/**
 * Plaud call watcher — Brigham's call recordings → lead timelines.
 *
 * Polls the Plaud CLI (authenticated once via `plaud login`) for recordings
 * from the last 2 days, pulls the AI summary for any not yet processed, and
 * POSTs each to the Sales Console's /api/plaud/inbound, which matches the
 * call to a lead (console-call timestamp → phone → name) and files the
 * summary as Call activity.
 *
 * LaunchAgent: com.blp.plaud-watcher (every 10 minutes).
 * State: ~/.blp-plaud-watcher-state.json (processed recording ids).
 * Not logged in yet? Exits quietly — goes live the moment `plaud login` runs.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const HOME = os.homedir();
const APP_URL = process.env.BLP_APP_URL || "https://blpsalesapp.netlify.app";
const STATE_FILE = path.join(HOME, ".blp-plaud-watcher-state.json");
const PLAUD = process.env.PLAUD_BIN || path.join(HOME, ".hermes", "node", "bin", "plaud");
const MAX_PER_RUN = 5;
const DAYS = process.env.PLAUD_DAYS || "2"; // look-back window (override for backfills)

function envVal(name) {
  const env = fs.readFileSync(path.join(HOME, "salesapp2", ".env.local"), "utf8");
  const m = env.match(new RegExp(`^${name}=(.+)$`, "m"));
  return m ? m[1].trim() : "";
}

function key() {
  const v = envVal("BLP_ARNOLD_ACCESS_KEY");
  if (!v) throw new Error("BLP_ARNOLD_ACCESS_KEY missing");
  return v;
}

/**
 * Make the call audio permanent: Plaud's download links die after 24h, so
 * pull the MP3 and park it in the public Supabase bucket. Returns the
 * forever-URL, or "" (caller falls back to the temporary Plaud link).
 */
async function archiveAudio(recordingId, plaudUrl) {
  const base = envVal("SUPABASE_URL");
  const skey = envVal("SUPABASE_SERVICE_KEY");
  if (!base || !skey || !plaudUrl) return "";
  try {
    const audio = await fetch(plaudUrl);
    if (!audio.ok) throw new Error(`download ${audio.status}`);
    const bytes = Buffer.from(await audio.arrayBuffer());
    if (bytes.length > 80_000_000) throw new Error("audio too large");
    const objectPath = `call-audio/${recordingId}.mp3`;
    const up = await fetch(`${base}/storage/v1/object/blp-media/${objectPath}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${skey}`, "Content-Type": "audio/mpeg", "x-upsert": "true" },
      body: bytes,
    });
    if (!up.ok) throw new Error(`upload ${up.status}: ${(await up.text()).slice(0, 120)}`);
    return `${base}/storage/v1/object/public/blp-media/${objectPath}`;
  } catch (e) {
    console.log(`${recordingId}: audio archive failed (${String(e.message || e).slice(0, 80)}) — using 24h link`);
    return "";
  }
}

function plaud(args) {
  // launchd's PATH lacks the node dir; the plaud bin's shebang needs it.
  const binDir = path.dirname(PLAUD);
  return execFileSync(PLAUD, args, {
    encoding: "utf8",
    timeout: 60_000,
    env: { ...process.env, PATH: `${binDir}:${process.env.PATH || "/usr/bin:/bin"}` },
  });
}

function loggedIn() {
  if (!fs.existsSync(path.join(HOME, ".plaud", "tokens.json"))) return false;
  try {
    plaud(["me"]);
    return true;
  } catch {
    return false;
  }
}

/** Pull recording ids (+ any inline metadata) out of CLI table/line output. */
function parseRecordings(text) {
  const out = [];
  for (const line of text.split("\n")) {
    // ids in Plaud listings are long hex/uuid-ish tokens; grab the first per line
    const id = (line.match(/\b([0-9a-f]{16,}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/i) || [])[1];
    if (!id) continue;
    const started = (line.match(/\b(20\d{2}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?)\b/) || [])[1];
    out.push({ id, line: line.trim(), started });
  }
  return out;
}

function fileMeta(id) {
  // `plaud file` prints "key: value" lines: name, start_at (ISO, local),
  // duration like "8m39s".
  const meta = { title: "", startedAt: null, durationSec: null };
  try {
    const detail = plaud(["file", id]);
    meta.title = (detail.match(/^\s*name:\s*(.+)$/m) || [])[1]?.trim() || "";
    const dt = (detail.match(/^\s*start_at:\s*(\S+)/m) || [])[1];
    if (dt) meta.startedAt = new Date(dt).toISOString();
    const dur = (detail.match(/^\s*duration:\s*(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?/m) || []);
    const secs = (Number(dur[1]) || 0) * 3600 + (Number(dur[2]) || 0) * 60 + (Number(dur[3]) || 0);
    if (secs) meta.durationSec = secs;
  } catch {
    /* metadata is best-effort */
  }
  return meta;
}

async function main() {
  if (!loggedIn()) {
    console.log("plaud: not logged in yet — run `plaud login` (waiting quietly)");
    return;
  }
  const state = fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) : { seen: [] };
  const seen = new Set(state.seen || []);

  const recordings = parseRecordings(plaud(["recent", "--days", DAYS]));
  const fresh = recordings.filter((r) => !seen.has(r.id)).slice(0, MAX_PER_RUN);
  if (!fresh.length) {
    console.log("no new recordings");
    return;
  }

  for (const rec of fresh) {
    let summary = "";
    try {
      summary = plaud(["summary", rec.id]).trim();
    } catch (e) {
      // Summary may still be processing — leave unseen so the next run retries.
      console.log(`${rec.id}: summary not ready (${String(e).slice(0, 80)})`);
      continue;
    }
    if (!summary || /no summary|not available|still processing|processing in progress/i.test(summary)) {
      console.log(`${rec.id}: no summary yet — will retry`);
      continue;
    }
    const meta = fileMeta(rec.id);
    // The transcript is where lead names actually live ("Hi Darren, this is
    // Brigham…") — titles/summaries rarely name the customer. Send the
    // opening minutes so the console's name matcher has something real.
    let transcriptExcerpt = "";
    try {
      transcriptExcerpt = plaud(["transcript", rec.id]).trim().slice(0, 6000);
    } catch {
      /* transcript may still be processing — summary alone is fine */
    }
    // Audio: grab Plaud's 24h link, then archive the MP3 to Supabase for a
    // permanent URL (falls back to the temporary link if that fails).
    let audioUrl = "";
    try {
      audioUrl = (plaud(["audio", rec.id]).match(/https:\/\/\S+/) || [])[0] || "";
    } catch {
      /* audio link is best-effort */
    }
    audioUrl = (await archiveAudio(rec.id, audioUrl)) || audioUrl;
    const payload = JSON.stringify({
      recordingId: rec.id,
      title: meta.title,
      startedAt: meta.startedAt || (rec.started ? new Date(rec.started.replace(" ", "T")).toISOString() : null),
      durationSec: meta.durationSec,
      summary: summary.slice(0, 4000),
      transcriptExcerpt,
      audioUrl,
    });
    // One retry — serverless cold starts / dev-server recompiles drop the
    // occasional connection, and a crash here loses the whole run's state.
    let res;
    for (let attempt = 1; ; attempt++) {
      try {
        res = await fetch(`${APP_URL}/api/plaud/inbound`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-blp-key": key() },
          body: payload,
        });
        break;
      } catch (e) {
        if (attempt >= 2) throw e;
        console.log(`${rec.id}: fetch failed — retrying in 3s`);
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
    const body = await res.json().catch(() => ({}));
    console.log(`${rec.id}: ${res.status} matched=${body.matched} ${body.leadName || ""} ${body.how || ""}`);
    if (res.ok) seen.add(rec.id);
  }

  fs.writeFileSync(STATE_FILE, JSON.stringify({ seen: [...seen].slice(-500) }));
}

main().catch((e) => {
  console.error("plaud watcher error:", e.message);
  process.exit(1);
});
