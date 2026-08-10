/**
 * Planner "notes → adjusted schedule" — Brigham writes adjustments and
 * standing rules beside each tech's proposed week in the Shop Manager;
 * this function has Claude revise the proposal accordingly, saves the
 * revised plan back to the Store Map bridge, and appends any standing
 * rules to the "Scheduling Rules" tab so every future weekly draft
 * (the Saturday routine) obeys them. The training loop lives in the app.
 *
 *   POST {key, nonce, notes: {techName: "..."}, global: "...", by: "Brigham"}
 *
 * BACKGROUND function: a full plan revision takes 30-90s, past the sync
 * function limit, so Netlify returns 202 immediately and the result is
 * written to the "adjust-results" blob store under the caller's nonce —
 * the Planner polls adjust-result?nonce=... to pick it up.
 *
 * Env: ANTHROPIC_API_KEY, STOREMAP_TEAM_PIN (+ Google service account, Twilio-independent)
 */
import * as crypto from "node:crypto";
import { getStore } from "@netlify/blobs";
import { logAdjustment, denverStamp } from "./lib/adjust-log";

const SHEET_ID = "11RoeVRETag5rZYX6_tEH-rf6x8JL0JeZU0P5AT0WI-I";
const RULES_TAB = "Scheduling Rules";
const BRIDGE = "https://script.google.com/macros/s/AKfycbxY4BKnr_Tr0iCTc9itCWhNYLvgszmkI1IoYSkbBWpyAqRtWI-yaUkJQjcVdgG58KXt/exec";
const MODEL = process.env.ADJUST_MODEL || "claude-sonnet-5";
const APP_KEY = process.env.BLP_APP_ACCESS_KEY || "pianoman";

let tokenCache: { token: string; exp: number } | null = null;
async function googleToken(scope = "https://www.googleapis.com/auth/spreadsheets"): Promise<string> {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || "";
  const key = (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
  const now = Math.floor(Date.now() / 1000);
  if (tokenCache && tokenCache.exp > now + 60) return tokenCache.token;
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const header = b64({ alg: "RS256", typ: "JWT" });
  const claims = b64({ iss: email, scope, aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 });
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  const signature = signer.sign(key).toString("base64url");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${header}.${claims}.${signature}` }),
  });
  const json = (await res.json()) as { access_token: string; expires_in: number };
  tokenCache = { token: json.access_token, exp: now + json.expires_in };
  return json.access_token;
}
async function sheets(path: string, method = "GET", body?: unknown) {
  const t = await googleToken();
  const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/${path}`,
    { method, headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined });
  return r.json();
}
async function readRules(): Promise<string[]> {
  const j = await sheets(`values/${encodeURIComponent(`'${RULES_TAB}'!A2:C200`)}`);
  return ((j.values as string[][]) || []).map(r => r[1] || "").filter(Boolean);
}
async function appendRules(rules: string[], by: string) {
  if (!rules.length) return;
  await sheets(`values/${encodeURIComponent(`'${RULES_TAB}'!A1`)}:append?valueInputOption=RAW`, "POST",
    { values: rules.map(r => [denverStamp(), r, by]) });
}

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

  // current proposal
  let plan: any = null;
  try {
    const r = await fetch(BRIDGE + "?fn=proposal", { redirect: "follow" });
    const j = await r.json();
    if (j.ok) plan = j.plan;
  } catch { /* fall through */ }
  if (!plan) {
    try {
      const r2 = await fetch("https://blpshop.netlify.app/data/schedule-proposal.json");
      if (r2.ok) plan = await r2.json();
    } catch { /* none */ }
  }
  if (!plan) return finish({ error: "no proposal found to adjust" }, 404);

  const rules = await readRules().catch(() => [] as string[]);
  const notesTxt = Object.entries(body.notes || {})
    .filter(([, v]) => String(v || "").trim())
    .map(([k, v]) => `${k}: ${String(v).trim()}`).join("\n");
  const globalTxt = String(body.global || "").trim();
  if (!notesTxt && !globalTxt) return finish({ error: "no notes to apply" }, 400);

  const tools = [{
    name: "revised_schedule",
    description: "Return the fully revised plan plus a change log and any standing rules to remember.",
    input_schema: { type: "object", properties: {
      plan: { type: "object", description: "The COMPLETE revised plan JSON, same shape as the input plan" },
      changes: { type: "array", items: { type: "string" }, description: "Plain-English list of every adjustment made" },
      rules_extracted: { type: "array", items: { type: "string" }, description: "Standing rules to remember for ALL future weeks (only genuinely reusable rules, rephrased crisply; empty if none)" },
      questions: { type: "array", items: { type: "string" }, description: "Anything ambiguous that needs Brigham's clarification" },
    }, required: ["plan", "changes", "rules_extracted"] },
  }];
  const sys = "You revise the weekly technician schedule for Brigham Larson Pianos (piano restoration shop). "
    + "You get the current proposal plan JSON, Brigham's per-technician notes, and the standing scheduling rules. "
    + "Apply the notes faithfully: move/resize/replace blocks, keep the JSON shape EXACTLY (days = 5 arrays of "
    + "[start,end,kind,title,note]; times are shop-clock 12h without am/pm where 7-11=morning, 12-6=afternoon; "
    + "kind must be an existing colors key). Keep every tech's hours realistic and keep the Friday 2:30-3:30 "
    + "cleaning block for full-day techs. Update the 'who' summary line when a tech's pianos change. "
    + "Add/adjust bottlenecks entries when notes reveal blockers. Distinguish one-off adjustments (apply them, "
    + "list in changes) from standing rules ('always', 'never', 'from now on', 'remember') which also go in "
    + "rules_extracted. Do not invent work that wasn't asked for.";
  const userMsg = `STANDING RULES:\n${rules.map(r => "- " + r).join("\n") || "(none yet)"}\n\n`
    + `BRIGHAM'S NOTES THIS WEEK:\n${globalTxt ? "GLOBAL: " + globalTxt + "\n" : ""}${notesTxt}\n\n`
    + `CURRENT PLAN JSON:\n${JSON.stringify(plan)}`;

  const ai = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": process.env.ANTHROPIC_API_KEY!, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, max_tokens: 32000, system: sys, tools,
      tool_choice: { type: "tool", name: "revised_schedule" },
      messages: [{ role: "user", content: userMsg }] }),
  });
  const aj = await ai.json();
  const tu = (aj.content || []).find((c: any) => c.type === "tool_use");
  if (!tu) return finish({ error: "AI revision failed: " + (aj.error?.message || "no output") }, 502);
  const out = tu.input;

  // persist: rules to the sheet, revised plan to the bridge
  await appendRules(out.rules_extracted || [], String(body.by || "Brigham"));
  let saved = false, saveErr = "";
  try {
    const sv = await fetch(BRIDGE, { method: "POST", redirect: "follow",
      headers: { "content-type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ pin: process.env.STOREMAP_TEAM_PIN || "", action: "saveproposal",
        week: out.plan.week, weekStart: out.plan.weekStart, plan: JSON.stringify(out.plan),
        user: { name: String(body.by || "Brigham") + " (Planner notes)" } }) });
    const sj = await sv.json();
    saved = !!sj.ok; saveErr = sj.error || "";
  } catch (e: any) { saveErr = String(e.message || e); }

  await logAdjustment({ by: String(body.by || "Brigham"), kind: "schedule notes",
    input: (globalTxt ? "GLOBAL: " + globalTxt + "\n" : "") + notesTxt,
    outcome: (out.changes || []).join("\n"), rules: out.rules_extracted || [],
    questions: out.questions || [], saved, saveErr });

  return finish({ ok: true, saved, saveErr, week: out.plan.week,
    changes: out.changes || [], rules_saved: out.rules_extracted || [],
    questions: out.questions || [], plan: out.plan });
};
const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type",
  "access-control-allow-methods": "POST, OPTIONS" };
function json(o: unknown, status = 200) {
  return new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", ...CORS } });
}
