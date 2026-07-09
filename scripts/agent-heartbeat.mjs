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
import { execSync } from "node:child_process";

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

/** OpenClaw cron store (live machines only — `.migrated` stores are retired). */
function loadOpenClawJobs(storePath) {
  if (!fs.existsSync(storePath)) return [];
  try {
    const d = JSON.parse(fs.readFileSync(storePath, "utf8"));
    const jobs = Array.isArray(d) ? d : d.jobs || [];
    return jobs.map((j) => ({
      profile: j.agentId || "main",
      cron: {
        name: j.name || j.id,
        enabled: j.enabled !== false,
        schedule: j.schedule?.expr || "",
        nextRunAt: j.state?.nextRunAtMs ? new Date(j.state.nextRunAtMs).toISOString() : null,
        lastRunAt: j.state?.lastRunAtMs ? new Date(j.state.lastRunAtMs).toISOString() : null,
        lastStatus: j.state?.lastStatus || null,
        lastError: j.state?.lastError ? String(j.state.lastError).slice(0, 200) : null,
      },
    }));
  } catch (e) {
    console.error(`skip ${storePath}: ${e.message}`);
    return [];
  }
}

/**
 * launchd services named com.blp.<agent>-… report as that agent's
 * "service" entries (e.g. Chris's app server, Arnold's tunnel).
 */
function loadLaunchdServices(knownSlugs) {
  const out = [];
  let listing = "";
  try {
    listing = execSync("launchctl list", { encoding: "utf8", timeout: 10_000 });
  } catch {
    return out;
  }
  for (const line of listing.split("\n")) {
    const m = line.trim().match(/^(\S+)\t(\S+)\t(com\.blp\.\S+)$/) || line.trim().match(/^(\S+)\s+(\S+)\s+(com\.blp\.\S+)$/);
    if (!m) continue;
    const [, pid, exitCode, label] = m;
    if (label === "com.blp.agent-heartbeat") continue; // that's us
    const slug = label
      .replace("com.blp.", "")
      .split(/[-.]/)
      .find((part) => knownSlugs.has(part));
    if (!slug) continue;
    const running = pid !== "-";
    const cleanExit = exitCode === "0";
    out.push({
      profile: slug,
      cron: {
        name: `service ${label.replace("com.blp.", "")}`,
        enabled: true,
        schedule: "launchd",
        nextRunAt: null,
        lastRunAt: null,
        // A periodic job that last exited 0, or a daemon currently running, is healthy.
        lastStatus: running || cleanExit ? "ok" : "error",
        lastError: running || cleanExit ? null : `not running, last exit code ${exitCode}`,
      },
    });
  }
  return out;
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
all.push(...loadOpenClawJobs(path.join(HOME, ".openclaw", "cron", "jobs.json")));

const registry = JSON.parse(
  fs.readFileSync(path.join(HOME, "salesapp2", "src", "lib", "agent-registry.json"), "utf8")
);
const knownSlugs = new Set(registry.map((a) => a.slug));
all.push(...loadLaunchdServices(knownSlugs));

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
