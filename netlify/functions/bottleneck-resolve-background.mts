/**
 * Bottleneck answers → actions. Each bottleneck card on the Planner gets an
 * answer box; Brigham writes the clarification ("288901 goes to spot 84",
 * "yes the Bösendorfer really spans 42+45", "that serial is 2783600") and
 * this function has Claude translate the answers into real Store Map bridge
 * writes (moves, phases, tracks…), updates or clears the resolved bottleneck
 * entries on the proposal, and banks any standing rules in the Scheduling
 * Rules tab. Same training loop as the schedule notes — answers become
 * actions, actions get logged under Brigham's name.
 *
 *   POST {key, nonce, items: [{title, body, answer}], by}
 *   BACKGROUND function — result lands in the "adjust-results" blob store
 *   under the nonce; the Planner polls adjust-result?nonce=…
 *   → {ok, executed: [...], bottlenecks_updated, rules_saved, questions}
 *
 * Env: ANTHROPIC_API_KEY, STOREMAP_TEAM_PIN (+ Google service account)
 */
import * as crypto from "node:crypto";
import { getStore } from "@netlify/blobs";
import { logAdjustment, denverStamp } from "./lib/adjust-log";

const SHEET_ID = "11RoeVRETag5rZYX6_tEH-rf6x8JL0JeZU0P5AT0WI-I";
const RULES_TAB = "Scheduling Rules";
const BRIDGE = "https://script.google.com/macros/s/AKfycbxY4BKnr_Tr0iCTc9itCWhNYLvgszmkI1IoYSkbBWpyAqRtWI-yaUkJQjcVdgG58KXt/exec";
const STORE_API = "https://blpstoremap.netlify.app/api/data";
const MODEL = process.env.ADJUST_MODEL || "claude-sonnet-5";
const APP_KEY = process.env.BLP_APP_ACCESS_KEY || "pianoman";

let tokenCache: { token: string; exp: number } | null = null;
async function googleToken(): Promise<string> {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || "";
  const key = (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
  const now = Math.floor(Date.now() / 1000);
  if (tokenCache && tokenCache.exp > now + 60) return tokenCache.token;
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const header = b64({ alg: "RS256", typ: "JWT" });
  const claims = b64({ iss: email, scope: "https://www.googleapis.com/auth/spreadsheets",
    aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 });
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  const signature = signer.sign(key).toString("base64url");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${header}.${claims}.${signature}` }) });
  const json = (await res.json()) as { access_token: string; expires_in: number };
  tokenCache = { token: json.access_token, exp: now + json.expires_in };
  return json.access_token;
}
async function appendRules(rules: string[], by: string) {
  if (!rules.length) return;
  const t = await googleToken();
  await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(`'${RULES_TAB}'!A1`)}:append?valueInputOption=RAW`,
    { method: "POST", headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" },
      body: JSON.stringify({ values: rules.map(r => [denverStamp(), r, by]) }) });
}
async function bridgeOnce(body: Record<string, unknown>) {
  const r = await fetch(BRIDGE, { method: "POST", redirect: "follow",
    headers: { "content-type": "text/plain;charset=utf-8" },
    // The bridge accepts the team PIN, the app key, or a verified Google
    // sign-in. STOREMAP_TEAM_PIN was missing/stale in the Netlify env, so
    // every executed action came back "unauthorized" for everyone (Mark
    // 9/11) — the app key is always accepted, so send both.
    body: JSON.stringify({ pin: APP_KEY, key: APP_KEY, ...body }) });
  let j: any = null;
  try { j = await r.json(); } catch { j = { error: "bridge answered with a non-JSON page (deploying?)" }; }
  return j;
}
// the bridge serves its generic ping ({ok:true, service}) for a few minutes
// after each deploy WITHOUT running the action — that read as ✓ before
// (12:20 run today). Retry through it; never count it as success.
async function bridge(body: Record<string, unknown>) {
  for (let a = 0; a < 3; a++) {
    const j = await bridgeOnce(body);
    if (!(j && j.service && !j.error)) return j;
    await new Promise(r => setTimeout(r, 2000 * (a + 1)));
  }
  return { error: "the Google bridge is mid-deploy — try again in a minute" };
}

const ALLOWED = new Set(["move", "setphase", "setdone", "settrack", "setcabinetry", "queue",
  "settype", "setpayplan", "setkeys", "markduplicate", "unmarkduplicate", "note"]);   // note → scope note on the card

/* Phases this flow may never set unattended (Walter 9/17). "Delivered" does not
 * just change a dropdown — the bridge physically relocates the row below the
 * SOLD divider and the piano leaves the map. Hallet Davis 1700946 went that way
 * on Sep 11 when an answer of Mark's was read as "this one was delivered", and
 * nobody noticed for six days. Every other phase is a dropdown someone can put
 * back in seconds; these two are not, so they become a job for a human. The
 * prompt says so too — this is the guard that does not depend on the model. */
const HUMAN_ONLY_PHASES = new Set(["delivered", "sold"]);

export default async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  let body: any;
  try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }
  // every exit writes the result blob so the polling UI always hears back
  const nonce = String(body.nonce || "");
  const finish = async (o: unknown, status = 200) => {
    if (nonce) { try { await getStore("adjust-results").setJSON(nonce, o); } catch (e) { /* blob store down */ } }
    return json(o, status);
  };
  if ((body.key || "") !== APP_KEY) return finish({ error: "unauthorized" }, 403);
  if (!process.env.ANTHROPIC_API_KEY) return finish({ error: "AI key not configured yet (Netlify env ANTHROPIC_API_KEY)" }, 500);
  const items = (body.items || []).filter((i: any) => String(i.answer || "").trim());
  if (!items.length) return finish({ error: "no answers provided" }, 400);

  // grounding: live piano list + current proposal
  let pianos: any[] = [];
  try {
    const d = await (await fetch(STORE_API)).json();
    pianos = (d.pianos || []).filter((p: any) => p.active && p.serial);
  } catch { return finish({ error: "Store Map unreachable" }, 502); }
  const roster = pianos.map(p => `${p.serial} | ${String(p.summary).slice(0, 36)} | map ${p.location} | ${p.phase || "-"}`).join("\n");
  let plan: any = null;
  // bridge only, with retries (see schedule-adjust-background 9/11); a plan
  // for a week that is already over is not touched
  for (let a = 0; a < 3 && !plan; a++) {
    try {
      const j = await (await fetch(BRIDGE + "?fn=proposal&_=" + Date.now(), { redirect: "follow", signal: AbortSignal.timeout(45000) })).json();
      if (j.ok) plan = typeof j.plan === "string" ? JSON.parse(j.plan) : j.plan;
    } catch {}
    if (!plan && a < 2) await new Promise(r => setTimeout(r, 3000));
  }
  if (plan && plan.weekStart && new Date(plan.weekStart + "T00:00:00-06:00").getTime() < Date.now() - 6 * 86400000) plan = null;

  const tools = [{
    name: "resolution",
    description: "Turn Brigham's bottleneck answers into concrete actions.",
    input_schema: { type: "object", properties: {
      actions: { type: "array", items: { type: "object", properties: {
        action: { type: "string", enum: [...ALLOWED] },
        serial: { type: "string", description: "EXACT serial from the piano list" },
        newLocation: { type: "string" }, phase: { type: "string" }, note: { type: "string" },
        phases: { type: "array", items: { type: "string" } },
        tracks: { type: "array", items: { type: "string" } },
        cabinetry: { type: "string" }, position: { type: "integer" },
        type: { type: "string" }, plan: { type: "string" }, keys: { type: "string" },
        why: { type: "string", description: "which answer this implements" },
      }, required: ["action", "serial", "why"] } },
      bottleneck_updates: { type: "array", items: { type: "object", properties: {
        title: { type: "string", description: "existing bottleneck title (exact)" },
        resolved: { type: "boolean" },
        new_body: { type: "string", description: "updated body if partially resolved" },
      }, required: ["title", "resolved"] } },
      rules_extracted: { type: "array", items: { type: "string" } },
      followups: { type: "array", items: { type: "string" }, description: "things a HUMAN still must do (e.g. edit the Store Map sheet layout, add a Piano Log row with owner info Claude doesn't have)" },
      questions: { type: "array", items: { type: "string" } },
    }, required: ["actions", "bottleneck_updates", "rules_extracted"] } }];
  const sys = "You turn Brigham's answers to shop bottleneck questions into Store Map actions for Brigham "
    + "Larson Pianos. Only act on what an answer explicitly resolves — never guess serials (they must "
    + "come from the piano list) and never invent actions beyond the answers. Actions you cannot express "
    + "with the allowed bridge actions (sheet layout changes, adding brand-new pianos, emails) go in "
    + "followups for a human. Phases must be one of: New Arrival - Admin, Assessment, CAP, PRSB - Downbearing, "
    + "PRSB - Notching and Pins, Lacquer Soundboard, Restringing, Chip Tuning, DHRT, 1st Tuning, Refinishing, "
    + "QC & Assembly, 2nd Tuning, Exit Prep - Admin, In Queue, Paused, For Sale, Sale Pending, "
    + "Post Sale QC, Waiting on Brigham, Waiting on Curtis Harper, Waiting on Customer, Waiting on OTHER. "
    + "NEVER set a phase of \"Delivered\" or \"Sold\" — those take a piano off the map and a human must do "
    + "them. If an answer says a piano was delivered or sold, put it in followups instead. "
    + "Use action \"note\" with a `note` field to record an instruction or status on a piano's card. "
    + "Answers that state lasting policy go in rules_extracted.";
  const userMsg = "BOTTLENECKS AND BRIGHAM'S ANSWERS:\n"
    + items.map((i: any) => `• ${i.title}\n  Context: ${i.body}\n  ANSWER: ${i.answer}`).join("\n\n")
    + `\n\nPIANO LIST:\n${roster}`;

  const ai = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": process.env.ANTHROPIC_API_KEY!, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, max_tokens: 8000, system: sys, tools,
      tool_choice: { type: "tool", name: "resolution" },
      messages: [{ role: "user", content: userMsg }] }) });
  const aj = await ai.json();
  const tu = (aj.content || []).find((c: any) => c.type === "tool_use");
  if (!tu) return finish({ error: "AI failed: " + (aj.error?.message || "no output") }, 502);
  const out = tu.input;

  // execute bridge actions
  const user = { name: String(body.by || "Brigham") + " (bottleneck answers)" };
  const executed: string[] = [];
  for (const a of out.actions || []) {
    if (!ALLOWED.has(a.action)) { executed.push(`✗ ${a.action}: not allowed`); continue; }
    if (a.action === "setphase" && HUMAN_ONLY_PHASES.has(String(a.phase || "").trim().toLowerCase())) {
      const want = String(a.phase || "").trim();
      (out.followups = out.followups || []).push(
        `Set ${a.serial} to "${want}" by hand if that is right — ${a.why || "from a bottleneck answer"} `
        + `(automation can't take a piano off the map)`);
      executed.push(`⏸ setphase ${a.serial} → ${want}: needs a human`);
      continue;
    }
    const p = pianos.find(x => x.serial === a.serial);
    if (!p) { executed.push(`✗ ${a.serial}: unknown serial`); continue; }
    const { action, serial, why, ...rest } = a;
    // "note" (the AI's most common ask — Mark 9/11 saw "note: not allowed")
    // → the card's Scope of Work special-instructions note
    const j = action === "note"
      ? await bridge({ action: "setscopenote", serial, row: p.row, user, value: String(a.note || "").slice(0, 500) })
      : await bridge({ action, serial, row: p.row, user, ...rest });
    const ok = j.ok || j.moved;
    executed.push(`${ok ? "✓" : "✗"} ${why || action + " " + serial}${ok ? "" : ": " + (j.error || "failed")}`);
    await new Promise(r => setTimeout(r, 350));
  }

  /* Update proposal bottlenecks.
   *
   * Matching used to be an exact string compare between the title the model
   * returned and the stored one, with no report of a miss (Walter 9/18). One
   * different character — a curly apostrophe, an em dash for a hyphen, a
   * trimmed word, a "RESOLVED:" prefix — and the item silently survived
   * forever, while the caller was still told "bottlenecks updated: N", since
   * N counted what the MODEL returned rather than what actually matched.
   * That is why the Manager Clarification list filled up with items that were
   * answered rounds ago.
   *
   * Now: titles are normalised before matching, anything the model marked
   * resolved that STILL does not match is reported instead of dropped, and an
   * item whose own title already says RESOLVED is retired on sight. */
  const normTitle = (t: unknown) => String(t ?? "")
    .replace(/^\s*(✅|⚠|RESOLVED|DONE|CLOSED)[:\s—–-]*/i, "")   // its own status prefix
    .replace(/[\u2018\u2019\u201B]/g, "'").replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2010-\u2015]/g, "-")                            // every dash to "-"
    .replace(/\s+/g, " ").trim().toLowerCase();

  let planSaved = false;
  let bResolved = 0, bRewritten = 0, bAutoDropped = 0;
  const bUnmatched: string[] = [];
  if (plan && (out.bottleneck_updates || []).length) {
    const ups = new Map((out.bottleneck_updates as any[]).map(u => [normTitle(u.title), u]));
    const matched = new Set<string>();
    plan.bottlenecks = (plan.bottlenecks || [])
      .filter((b: string[]) => {
        const k = normTitle(b[0]);
        const u = ups.get(k);
        if (u) matched.add(k);
        if (u?.resolved) { bResolved++; return false; }
        // answered in an earlier round, renamed rather than removed
        if (/^\s*(✅|RESOLVED|DONE|CLOSED)\b/i.test(String(b[0] || ""))) { bAutoDropped++; return false; }
        return true;
      })
      .map((b: string[]) => {
        const u = ups.get(normTitle(b[0]));
        if (u && u.new_body) { bRewritten++; return [b[0], u.new_body]; }
        return b;
      });
    for (const [k, u] of ups) {
      if (!matched.has(k) && u?.resolved) bUnmatched.push(String(u.title || "(untitled)"));
    }
    try {
      const sv = await bridge({ action: "saveproposal", week: plan.week, weekStart: plan.weekStart,
        plan: JSON.stringify(plan), user });
      planSaved = !!sv.ok;
    } catch { /* pending bridge update */ }
  }
  await appendRules(out.rules_extracted || [], String(body.by || "Brigham"));

  await logAdjustment({ by: String(body.by || "Brigham"), kind: "bottleneck answers",
    input: items.map((i: any) => `${i.title} → ${i.answer}`).join("\n"),
    outcome: [...executed,
      ...(bResolved ? [`bottlenecks cleared: ${bResolved}`] : []),
      ...(bAutoDropped ? [`bottlenecks retired (title already said resolved): ${bAutoDropped}`] : []),
      ...(bRewritten ? [`bottlenecks rewritten: ${bRewritten}`] : []),
      ...bUnmatched.map((t) => `⚠ could not match a resolved bottleneck to any on the board: "${t}"`),
      ...(out.followups || []).map((f: string) => "for a human: " + f)].join("\n"),
    rules: out.rules_extracted || [], questions: out.questions || [],
    saved: (out.bottleneck_updates || []).length ? planSaved : true,
    saveErr: (out.bottleneck_updates || []).length && !planSaved ? "plan save failed" : "" });

  return finish({ ok: true, executed, planSaved,
    // what actually changed on the board, not what the model asked for
    bottlenecks_updated: bResolved + bRewritten + bAutoDropped,
    bottlenecks_cleared: bResolved, bottlenecks_rewritten: bRewritten,
    bottlenecks_retired: bAutoDropped, bottlenecks_unmatched: bUnmatched,
    rules_saved: out.rules_extracted || [], followups: out.followups || [],
    questions: out.questions || [] });
};
const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type",
  "access-control-allow-methods": "POST, OPTIONS" };
function json(o: unknown, status = 200) {
  return new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", ...CORS } });
}
