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

function key() {
  const env = fs.readFileSync(path.join(HOME, "salesapp2", ".env.local"), "utf8");
  const m = env.match(/^BLP_ARNOLD_ACCESS_KEY=(.+)$/m);
  if (!m) throw new Error("BLP_ARNOLD_ACCESS_KEY missing");
  return m[1].trim();
}

function plaud(args) {
  return execFileSync(PLAUD, args, { encoding: "utf8", timeout: 60_000 });
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
  const meta = { title: "", startedAt: null, durationSec: null };
  try {
    const detail = plaud(["file", id]);
    meta.title = (detail.match(/(?:name|title)\s*[:|]\s*(.+)/i) || [])[1]?.trim() || "";
    const dt = (detail.match(/\b(20\d{2}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2})?)\b/) || [])[1];
    if (dt) meta.startedAt = new Date(dt.replace(" ", "T")).toISOString();
    const dur = (detail.match(/duration\s*[:|]\s*(\d+)/i) || [])[1];
    if (dur) meta.durationSec = Number(dur);
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

  const recordings = parseRecordings(plaud(["recent", "--days", "2"]));
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
    if (!summary || /no summary/i.test(summary)) {
      console.log(`${rec.id}: no summary yet — will retry`);
      continue;
    }
    const meta = fileMeta(rec.id);
    const res = await fetch(`${APP_URL}/api/plaud/inbound`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-blp-key": key() },
      body: JSON.stringify({
        recordingId: rec.id,
        title: meta.title,
        startedAt: meta.startedAt || (rec.started ? new Date(rec.started.replace(" ", "T")).toISOString() : null),
        durationSec: meta.durationSec,
        summary: summary.slice(0, 4000),
      }),
    });
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
