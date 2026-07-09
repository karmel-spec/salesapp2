#!/usr/bin/env node
/**
 * BLP agent heartbeat reporter — runs on any machine that hosts agents.
 *
 * Scans local Hermes cron stores (+ the Arnold gateway) and POSTs one
 * status payload to the Sales Console, which stores it in the
 * "Agent Status" tab of the Leads Log. Install on a 10-minute cron
 * (see the crontab line in the repo README / this commit message):
 *   every 10 min -> /opt/homebrew/bin/node ~/salesapp2/scripts/agent-heartbeat.mjs
 *
 * Config via env (defaults suit Karmel's MacBook):
 *   BLP_APP_URL   — console base URL
 *   BLP_KEY       — agent access key (else read from ~/salesapp2/.env.local)
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const HOME = os.homedir();
const APP_URL = process.env.BLP_APP_URL || "https://blpsalesapp.netlify.app";
const HERMES = path.join(HOME, ".hermes");

/** Hermes profile name → agent registry slug (only where they differ). */
const PROFILE_TO_SLUG = { eddy: "ed" };

function key() {
  if (process.env.BLP_KEY) return process.env.BLP_KEY;
  const envFile = path.join(HOME, "salesapp2", ".env.local");
  if (fs.existsSync(envFile)) {
    const m = fs.readFileSync(envFile, "utf8").match(/^BLP_ARNOLD_ACCESS_KEY=(.+)$/m);
    if (m) return m[1].trim();
  }
  throw new Error("No BLP_KEY env var and no BLP_ARNOLD_ACCESS_KEY in ~/salesapp2/.env.local");
}

function loadJobs(storePath, fallbackProfile) {
  if (!fs.existsSync(storePath)) return [];
  try {
    const d = JSON.parse(fs.readFileSync(storePath, "utf8"));
    const jobs = Array.isArray(d) ? d : d.jobs || [];
    return jobs.map((j) => ({
      profile: j.profile || fallbackProfile,
      cron: {
        name: j.name || j.id,
        enabled: j.enabled !== false && j.state !== "paused",
        schedule: j.schedule_display || j.schedule?.expr || "",
        nextRunAt: j.next_run_at || null,
        lastRunAt: j.last_run_at || null,
        lastStatus: j.last_status || null,
        lastError: j.last_error ? String(j.last_error).slice(0, 200) : null,
      },
    }));
  } catch (e) {
    console.error(`skip ${storePath}: ${e.message}`);
    return [];
  }
}

async function probe(url, timeoutMs = 3000) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    return res.ok;
  } catch {
    return false;
  }
}

// ---- gather ----
const all = [];
all.push(...loadJobs(path.join(HERMES, "cron", "jobs.json"), "main"));
const profilesDir = path.join(HERMES, "profiles");
if (fs.existsSync(profilesDir)) {
  for (const p of fs.readdirSync(profilesDir)) {
    all.push(...loadJobs(path.join(profilesDir, p, "cron", "jobs.json"), p));
  }
}

const registry = JSON.parse(
  fs.readFileSync(path.join(HOME, "salesapp2", "src", "lib", "agent-registry.json"), "utf8")
);
const knownSlugs = new Set(registry.map((a) => a.slug));

const bySlug = new Map();
for (const { profile, cron } of all) {
  const slug = PROFILE_TO_SLUG[profile] || profile;
  if (!knownSlugs.has(slug)) continue; // e.g. "main" store rows already carry their real profile
  if (!bySlug.has(slug)) bySlug.set(slug, []);
  bySlug.get(slug).push(cron);
}

const agents = [];
for (const [slug, crons] of bySlug) {
  const agent = { slug, online: null, crons };
  if (slug === "arnold") agent.online = await probe("http://127.0.0.1:8656/health");
  agents.push(agent);
}

// ---- report ----
const payload = { machine: os.hostname().replace(/\.local$/, ""), agents };
const res = await fetch(`${APP_URL}/api/agents/heartbeat`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "x-blp-key": key() },
  body: JSON.stringify(payload),
});
const body = await res.text();
console.log(`${new Date().toISOString()} ${res.status} ${body.slice(0, 200)} (${agents.length} agents: ${[...bySlug.keys()].sort().join(", ")})`);
if (!res.ok) process.exit(1);
