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
async function bridge(body: Record<string, unknown>) {
  const r = await fetch(BRIDGE, { method: "POST", redirect: "follow",
    headers: { "content-type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ pin: process.env.STOREMAP_TEAM_PIN || "", ...body }) });
  return r.json();
}

const ALLOWED = new Set(["move", "setphase", "setdone", "settrack", "setcabinetry", "queue",
  "settype", "setpayplan", "setkeys", "markduplicate", "unmarkduplicate"]);

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
  try { const j = await (await fetch(BRIDGE + "?fn=proposal", { redirect: "follow" })).json(); if (j.ok) plan = j.plan; } catch {}

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
    + "followups for a human. Phases must be one of: New Arrival - Admin, Assessment, CAP, PRSB & Plate "
    + "Refinishing, Lacquer Soundboard, Restringing, Chip Tuning, DHRT, 1st Tuning, Refinishing, "
    + "QC & Assembly, 2nd Tuning, Exit Prep - Admin, Delivered, In Queue, Paused, For Sale, "
    + "Waiting on Brigham, Waiting on Curtis Harper, Waiting on OTHER. Answers that state lasting policy "
    + "go in rules_extracted.";
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
    const p = pianos.find(x => x.serial === a.serial);
    if (!p) { executed.push(`✗ ${a.serial}: unknown serial`); continue; }
    const { action, serial, why, ...rest } = a;
    const j = await bridge({ action, serial, row: p.row, user, ...rest });
    const ok = j.ok || j.moved;
    executed.push(`${ok ? "✓" : "✗"} ${why || action + " " + serial}${ok ? "" : ": " + (j.error || "failed")}`);
    await new Promise(r => setTimeout(r, 350));
  }

  // update proposal bottlenecks
  let planSaved = false;
  if (plan && (out.bottleneck_updates || []).length) {
    const ups = new Map((out.bottleneck_updates as any[]).map(u => [u.title, u]));
    plan.bottlenecks = (plan.bottlenecks || [])
      .filter((b: string[]) => !(ups.get(b[0])?.resolved))
      .map((b: string[]) => { const u = ups.get(b[0]); return u && u.new_body ? [b[0], u.new_body] : b; });
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
      ...((out.bottleneck_updates || []).length ? [`bottlenecks updated: ${(out.bottleneck_updates || []).length}`] : []),
      ...(out.followups || []).map((f: string) => "for a human: " + f)].join("\n"),
    rules: out.rules_extracted || [], questions: out.questions || [],
    saved: (out.bottleneck_updates || []).length ? planSaved : true,
    saveErr: (out.bottleneck_updates || []).length && !planSaved ? "plan save failed" : "" });

  return finish({ ok: true, executed, planSaved,
    bottlenecks_updated: (out.bottleneck_updates || []).length,
    rules_saved: out.rules_extracted || [], followups: out.followups || [],
    questions: out.questions || [] });
};
const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type",
  "access-control-allow-methods": "POST, OPTIONS" };
function json(o: unknown, status = 200) {
  return new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", ...CORS } });
}
