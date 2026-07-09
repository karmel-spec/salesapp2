#!/usr/bin/env node
/**
 * Harvest per-agent info from the BLP Knowledge Vault (Obsidian) into
 * src/lib/agent-vault.json, which the agent console merges over the registry.
 *
 * Re-run whenever the vault's agent notes change:
 *   node scripts/harvest-vault.mjs
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const VAULT = path.join(os.homedir(), "Documents", "BLP Knowledge Vault");
const AGENTS_DIR = path.join(VAULT, "Agents");
const OUT = new URL("../src/lib/agent-vault.json", import.meta.url).pathname;

/** Vault folder first-names that differ from registry slugs. */
const NAME_TO_SLUG = { eddy: "ed" };

const read = (p) => (fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "");

/** Grab the body of a `## Heading` section (up to the next ## or EOF). */
function section(md, heading) {
  const re = new RegExp(`^##\\s+${heading}\\s*$([\\s\\S]*?)(?=^##\\s|\\n---|$(?![\\s\\S]))`, "mi");
  const m = md.match(re);
  return m ? m[1].trim() : "";
}

/** Top-level bullets of a block, wiki-link syntax flattened to plain text. */
function bullets(block) {
  return block
    .split("\n")
    .filter((l) => /^- \S/.test(l.trim()))
    .map((l) =>
      l
        .trim()
        .replace(/^- /, "")
        .replace(/\[\[([^\]|]*\|)?([^\]]+)\]\]/g, "$2")
        .replace(/\*\*/g, "")
        .trim()
    )
    .filter(Boolean);
}

const out = {};

/* ---- Structured marketing agents: "Name Larson (Role)" folders ---- */
for (const dir of fs.readdirSync(AGENTS_DIR)) {
  const m = dir.match(/^([A-Z][a-z]+) Larson \((.+)\)$/);
  if (!m) continue;
  const slug = NAME_TO_SLUG[m[1].toLowerCase()] || m[1].toLowerCase();
  const folder = path.join(AGENTS_DIR, dir);
  const profile = read(path.join(folder, `${dir} - Agent Profile.md`));
  const manual = read(path.join(folder, `${dir} - Operating Manual.md`));
  const projects = read(path.join(folder, `${dir} - Current Projects.md`));
  const cron = read(path.join(folder, `${dir} - Cron Jobs.md`));

  const approval = section(manual, "Approval Rules");
  const needsApproval = bullets(approval.split(/Can usually do autonomously:/i)[0] || "");
  const autonomous = bullets(approval.split(/Can usually do autonomously:/i)[1] || "");

  // Requested cron jobs appear as "### Title" under "## Requested Cron Jobs".
  const requested = [...(section(cron, "Requested Cron Jobs").matchAll(/^###\s+(.+)$/gm))].map((x) => x[1].trim());

  out[slug] = {
    mission: section(profile, "Mission").split("\n")[0] || null,
    responsibilities: bullets(section(profile, "Primary Responsibilities")),
    needsApproval,
    autonomous,
    currentProjects: bullets(section(projects, "Active / Proposed") || section(projects, "Active Projects")),
    openQuestions: bullets(section(projects, "Open Questions")),
    requestedCrons: requested,
    vaultFolder: `Agents/${dir}`,
    docs: ["Agent Profile", "Operating Manual", "Current Projects", "Cron Jobs"]
      .filter((d) => fs.existsSync(path.join(folder, `${dir} - ${d}.md`)))
      .map((d) => [d, `~/Documents/BLP Knowledge Vault/Agents/${dir}/${dir} - ${d}.md`]),
  };
}

/* ---- Identity-file agents: Agents/<slug>/IDENTITY.md (arnold, ivory, melody) ---- */
for (const slug of ["ivory", "melody", "arnold"]) {
  const folder = path.join(AGENTS_DIR, slug);
  const identity = read(path.join(folder, "IDENTITY.md"));
  if (!identity) continue;
  // Mission = first real paragraph after the front bullet list / --- rule.
  const afterRule = identity.split(/\n---+\n/)[1] || "";
  const para = afterRule
    .split(/\n\s*\n/)
    .map((s) => s.replace(/\n/g, " ").trim())
    .filter((s) => s && !s.startsWith("#") && !s.startsWith("-"));
  const vibe = (identity.match(/\*\*Vibe:\*\*\s*(.+)/) || [])[1];
  const docNames = ["IDENTITY.md", "SOUL.md", "MEMORY.md", "AGENTS.md", "STATUS.md"];
  out[slug] = {
    ...(out[slug] || {}),
    mission: para.slice(0, 2).join(" ") || null,
    vibe: vibe ? vibe.trim() : undefined,
    vaultFolder: `Agents/${slug}`,
    docs: docNames
      .filter((d) => fs.existsSync(path.join(folder, d)))
      .map((d) => [d.replace(".md", ""), `~/Documents/BLP Knowledge Vault/Agents/${slug}/${d}`]),
  };
}

/* ---- Lindsay: 80 Agents (OpenClaw)/Lindsay/current ---- */
{
  const cur = path.join(VAULT, "80 Agents (OpenClaw)", "Lindsay", "current");
  if (fs.existsSync(cur)) {
    out.lindsay = {
      ...(out.lindsay || {}),
      vaultFolder: "80 Agents (OpenClaw)/Lindsay/current",
      docs: fs
        .readdirSync(cur)
        .filter((f) => f.endsWith(".md"))
        .map((f) => [f.replace(".md", ""), `~/Documents/BLP Knowledge Vault/80 Agents (OpenClaw)/Lindsay/current/${f}`]),
    };
  }
}

fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");
console.log(`Wrote ${OUT}: ${Object.keys(out).length} agents — ${Object.keys(out).sort().join(", ")}`);
