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
import { normalizeBottlenecks, plateHoldText, tuningQueueText, cardPhaseText } from "./_blp-sched-lib.mts";

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
// The techs' weekly reports (Walter 10/2): Apply only ever saw the plan, the
// notes and the rules, so "re-check the weekly report and redo his week"
// got a shrug — the reports are read by the Saturday draft alone. Now the
// latest filed column of the year tab (header ≤ tomorrow, so a Friday-dated
// column counts this week) rides along, one entry per tech.
const REPORT_TAB = String(new Date().getFullYear());
async function readWeekReports(): Promise<{ label: string; byTech: Record<string, string> } | null> {
  const j = await sheets(`values/${encodeURIComponent(`'${REPORT_TAB}'!A1:CZ60`)}`);
  const rows: string[][] = (j.values || []) as string[][];
  if (!rows.length) return null;
  const hdr = rows[0];
  const limit = Date.now() + 86400000;
  let best = -1, bestT = -Infinity;
  hdr.forEach((h, i) => {
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(String(h || "").trim());
    if (!m) return;
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    const t = new Date(y, Number(m[1]) - 1, Number(m[2])).getTime();
    const filled = rows.slice(1).some(r => String(r[i] || "").trim());
    if (t <= limit && t > bestT && filled) { bestT = t; best = i; }
  });
  if (best < 0) return null;
  const byTech: Record<string, string> = {};
  rows.slice(1).forEach(r => {
    const n = String(r[0] || "").trim(), v = String(r[best] || "").trim();
    if (n && v) byTech[n] = v.length > 1400 ? v.slice(0, 1400) + " …" : v;
  });
  return { label: String(hdr[best]), byTech };
}
async function appendRules(rules: string[], by: string) {
  if (!rules.length) return;
  await sheets(`values/${encodeURIComponent(`'${RULES_TAB}'!A1`)}:append?valueInputOption=RAW`, "POST",
    { values: rules.map(r => [denverStamp(), r, by]) });
}

/* Approved time off for the plan week (Mark 10/23): the bridge's fn=timeoffrows
 * (status approved), keyed by first name. A whole day → that day index (Mon=0)
 * is cleared after the merge; a partial day (a Times value) is listed only. */
async function approvedTimeOff(plan: any): Promise<{ text: string; days: Record<string, Set<number>> }> {
  const ws = String(plan?.weekStart || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ws)) return { text: "", days: {} };
  const r = await fetch(BRIDGE + "?fn=timeoffrows&_=" + Date.now(), { redirect: "follow", signal: AbortSignal.timeout(30000) });
  const j = (await r.json()) as { rows?: { who: string; start: string; end: string; times: string; status: string }[] };
  const dayYmd: string[] = []; const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  for (let i = 0; i < 7; i++) { const d = new Date(ws + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + i); dayYmd.push(d.toISOString().slice(0, 10)); }
  const days: Record<string, Set<number>> = {}; const lines: string[] = [];
  for (const row of j.rows || []) {
    if (!/^approved/i.test(String(row.status || ""))) continue;
    const s = String(row.start || ""), e0 = String(row.end || ""), e = /^\d{4}-\d{2}-\d{2}$/.test(e0) ? e0 : s;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) continue;
    const idx = dayYmd.map((y, i) => (y >= s && y <= e ? i : -1)).filter(i => i >= 0);
    if (!idx.length) continue;
    const who = String(row.who || "").trim(), k = who.toLowerCase().split(/\s+/)[0];
    const times = String(row.times || "").trim();
    const label = idx.map(i => DOW[i] + " " + Number(dayYmd[i].slice(5, 7)) + "/" + Number(dayYmd[i].slice(8, 10))).join(", ");
    lines.push(`${who}: ${label} — ${times || "all day"}`);
    if (!times) { days[k] = days[k] || new Set(); idx.filter(i => i < 5).forEach(i => days[k].add(i)); }
  }
  return { text: lines.join("\n"), days };
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

  // current proposal — from the bridge ONLY, with retries. Never fall back to
  // the static snapshot on a write path: on 9/11 a slow bridge sent this job
  // to the Aug 10 snapshot, Claude applied Mark's notes to it, and the result
  // was SAVED over the live Sep 14–18 proposal (and a day of adjustments).
  let plan: any = null, planErr = "";
  for (let a = 0; a < 3 && !plan; a++) {
    try {
      const r = await fetch(BRIDGE + "?fn=proposal&_=" + Date.now(), { redirect: "follow", signal: AbortSignal.timeout(45000) });
      const j = await r.json();
      if (j.ok) plan = typeof j.plan === "string" ? JSON.parse(j.plan) : j.plan;
      else planErr = String(j.error || "bridge returned no plan");
    } catch (e: any) { planErr = String(e?.message || e); }
    if (!plan && a < 2) await new Promise(r => setTimeout(r, 3000));
  }
  if (!plan) return finish({ error: "Couldn't load the CURRENT proposal from the Google bridge (" + planErr.slice(0, 80) + ") — nothing was changed. Try again in a minute." }, 503);
  // a plan whose week is already over is stale by definition — refuse to edit it
  if (plan.weekStart && new Date(plan.weekStart + "T00:00:00-06:00").getTime() < Date.now() - 6 * 86400000) {
    return finish({ error: "The stored proposal is for " + (plan.week || plan.weekStart) + " — that week is over, so this would edit a stale plan. Restore or regenerate the current week first; nothing was changed." }, 409);
  }

  const rules = await readRules().catch(() => [] as string[]);
  const reports = await readWeekReports().catch(() => null);
  const plateHolds = await plateHoldText();
  const tuneQueue = await tuningQueueText();
  const cardPhases = await cardPhaseText(plan);
  // approved time off for the plan week (Mark 10/23) — from the Time Off requests
  const timeOff = await approvedTimeOff(plan).catch(() => ({ text: "", days: {} as Record<string, Set<number>> }));
  const notesTxt = Object.entries(body.notes || {})
    .filter(([, v]) => String(v || "").trim())
    .map(([k, v]) => `${k}: ${String(v).trim()}`).join("\n");
  const globalTxt = String(body.global || "").trim();
  if (!notesTxt && !globalTxt) return finish({ error: "no notes to apply" }, 400);

  const tools = [{
    name: "revised_schedule",
    description: "Return ONLY the technicians you changed (each one complete), the bottleneck list if it changed, a change log and any standing rules to remember.",
    input_schema: { type: "object", properties: {
      // Walter 10/16: returning the COMPLETE plan (~75k chars, 17 techs) ran the model
      // out of output room on a big week — Mark's notes came back "malformed" twice.
      // Only the touched techs come back now; everything else is kept as it is.
      changed_techs: { type: "array", items: { type: "object" }, description: "Every technician you changed, each as the COMPLETE tech object exactly as in the input plan (name, hours, who, days = 5 arrays of [start,end,kind,title,note], and any other fields it had). Omit technicians you did not change — they are kept as they are." },
      cleared_techs: { type: "array", items: { type: "string" }, description: "Technicians whose WHOLE week is cleared because a note says they are out / on vacation / 'clear his week' / 'do not schedule her this week' — their names exactly as in the plan. Each must ALSO appear in changed_techs with days = five empty arrays." },
      bottlenecks: { type: "array", items: { type: "array", items: { type: "string" } }, description: "ONLY if you changed the bottlenecks: the complete new list of [title, body] pairs. Omit to keep the current list." },
      reportOverrides: { type: "array", items: { type: "string" }, description: "ONLY if you changed them: the complete new reportOverrides list. Omit to keep the current one." },
      changes: { type: "array", items: { type: "string" }, description: "Plain-English list of every adjustment made" },
      rules_extracted: { type: "array", items: { type: "string" }, description: "Standing rules to remember for ALL future weeks (only genuinely reusable rules, rephrased crisply; empty if none)" },
      questions: { type: "array", items: { type: "string" }, description: "Anything ambiguous that needs Brigham's clarification" },
    }, required: ["changed_techs", "changes", "rules_extracted"] },
  }];
  const sys = "You revise the weekly technician schedule for Brigham Larson Pianos (piano restoration shop). "
    + "You get the current proposal plan JSON, Brigham's per-technician notes, and the standing scheduling rules. "
    + "Return ONLY the technicians your changes touch (each one complete, same shape as in the plan); untouched technicians are kept exactly as they are. "
    + "Apply the notes faithfully: move/resize/replace blocks, keep the JSON shape EXACTLY (days = 5 arrays of "
    + "[start,end,kind,title,note]; times are shop-clock 12h without am/pm where 7-11=morning, 12-6=afternoon; "
    + "kind must be an existing colors key). Keep every tech's hours realistic and keep the Friday 2:30-3:30 "
    + "cleaning block for full-day techs. Update the 'who' summary line when a tech's pianos change. "
    + "Add/adjust bottlenecks entries when notes reveal blockers — every bottlenecks entry MUST be a two-element array [title, body] (never a plain string); per-piano reconciliation notes belong in reportOverrides, not bottlenecks. Distinguish one-off adjustments (apply them, "
    + "list in changes) from standing rules ('always', 'never', 'from now on', 'remember') which also go in "
    + "rules_extracted. Do not invent work that wasn't asked for. "
    // Walter 10/13: Garrett's "add this note to calendar event" text was reworded,
    // fused into a "NEW per Brigham's note" sentence the calendar filter drops, and
    // put on Wednesday only — the bridge passes [CAL: …] through verbatim.
    // Mark 10/26: the [CAL: …] segment is the technician's calendar text —
    // the piano work only, second person; reasoning stays outside it
    + "CALENDAR NOTES (Mark 10/26 — standing rule): a block note's [CAL: …] segment, at the very START of the note, is the "
    + "technician's calendar text; your reasoning for the managers goes after it, outside the brackets. (a) When a note asks "
    + "for words to appear on the calendar ('add this note to the calendar event', 'call out in calendar', 'add to calendar "
    + "descriptions', 'put on his events', and the like), copy those words EXACTLY as written — same wording, spelling, "
    + "capitalization and order; no paraphrase, no attribution, no added conditions — into the segment of EVERY block that "
    + "note covers (every day of that assignment, not just the first). (b) Otherwise, when you write or change a block, give it "
    + "a segment only if the technician needs something for the PIANO WORK in it: what to do or check, next steps, a known "
    + "problem and how to fix it, parts they're waiting on or that arrived, a client's request about the piano. Write it TO the "
    + "technician, second person / imperative: 'Next steps: finish the let-off', 'Waiting on #9 bridge pins', 'Bush the pedal "
    + "rod hole with felt' — never he/she/his/her/they or the technician's name. NEVER in the segment: anything about the "
    + "schedule (times, days, dates, end times, days off, field bookings, 'full shop day', open slots, who else covers what, "
    + "reassignments, pacing) — the ONE exception is a soft deadline tied to a dependent event already scheduled, written "
    + "'Deadline: shoot to finish by Thu — QC is scheduled Fri' (Brigham 7/27, kept by Mark 10/26); anything private (health, "
    + "personal matters, comments on progress or performance, payment status, client contact details); client / owner names "
    + "(technicians work by make, model and serial — owner names are for Melissa, Brigham and Mark); anything written for the managers rather than the technician — why the block "
    + "is here, card or scope-note status ('That closes the card's \"CAP stays open - waiting for new whippens\" scope note, "
    + "so the CAP can actually finish' is for Mark, not Avery), twin-check / duplicate-serial notes ('also on the TWIN CHECK list "
    + "… distinguish by serial'), report echoes, queue ranks, 'continuing'; the make/serial or spot (the title and location carry them). Nothing piano-specific "
    + "to say → no segment. Separate several lines inside one segment with ' / '. Never put ']' inside the segment. "
    // Mark 10/29 (Melissa 102626terry10): Chickering 80147 got a "pre-delivery QC" the day
    // before it went to Barrus Pianos to have its QRS INSTALLED — the move was read as a delivery
    + "OUTSIDE-SHOP TRIPS ARE NOT DELIVERIES (Mark 10/29 — standing rule): a moving-calendar trip that takes a piano TO an "
    + "outside shop or specialist — Barrus Pianos, David Hyde, Curtis Harper (plating), a QRS or player installer — is not a "
    + "delivery, even when the piano is sold: it gets NO pre-delivery tuning or QC before that trip. Outside work (QRS / "
    + "player installs above all) is checked AFTER the piano comes back: schedule its QC once the return is on the moving "
    + "calendar, before the trip to the customer. A Piano Log note like 'we are putting a QRS on' means the QRS is NOT on yet. "
    + "APPROVED TIME OFF (Mark 10/23): the APPROVED TIME OFF list below is binding — a technician's whole day off stays "
    + "empty whatever the notes or carried-forward lanes say, and a partial day gets no blocks in the stated hours. "
    + "TECHNICIAN OUT (Mark 10/23 — standing rule): when a note says a technician is out, on vacation, 'out all week', "
    + "'clear his/her week', or 'do not schedule him/her this week', that technician gets NO work that week: put the name in "
    + "cleared_techs AND return the tech in changed_techs with days = five empty arrays [[],[],[],[],[]], hours '' and "
    + "who = 'OUT this week — <the reason as given>'. Never leave a carried-forward lane on a tech who is out, and never "
    + "move their work onto another tech unless the note says who takes it. This applies in every later run too: a tech "
    + "already marked OUT stays empty until a note says they are back. "
    + "PLATES (Scheduling Rule 94): a piano listed under PLATES NOT READY has its plate out and not yet refinished — never "
    + "schedule its Restringing (or any stringing) until the card says Plate storage — AFTER or Back in piano; give that tech "
    + "other work instead and say so in changes. If a note asks for it anyway, keep the block and add a question. Approve "
    + "also holds such blocks. "
    + "KORBAN'S TUNING SLOTS (Walter 10/14): pre-booked tunings stay as they are; open slots go to chip tunings first, then "
    + "tunings a piano's card phase calls for (1st / 2nd tuning), then the TUNING QUEUE below in its order (⚡ ASAP first) — "
    + "the queue replaces picking for-sale floor pianos yourself. Queue pianos that don't fit are simply left out — they never "
    + "carry to next week; only chip tunings, card-phase tunings and Store Map request tunings overflow. "
    + "A MANAGER'S TUNING PRIORITY LIST (Mark 10/19): when a note names pianos as Korban's top tuning priority (with or "
    + "without days/slots), those come first exactly as given — Brigham's priorities outrank everything, pre-booked tunings "
    + "included. Then re-place EVERY pre-booked piano the list displaced into the slots that remain this week, in their "
    + "original order, then overflow to next week; never drop a pre-booked piano and never leave a slot empty while a "
    + "pre-booked piano is unplaced. Say in changes which pre-booked tunings moved where — Approve moves the calendar events "
    + "to the plan's slots. Ask a question only when the list is ambiguous (two pianos for one slot, a serial on neither the "
    + "calendar nor a card). "
    + "KORBAN'S HARDWARE BUFFING QUEUE (Mark 10/19): keep the one 11:00-15:00 block per day (MONDAY 11:00-14:30 — his weekly "
    + "'Vacuum maintenance: clean filters, empty buckets' is a standing 2:30-3:00 event on his own calendar), but do NOT write job lists or "
    + "priorities into its note — Approve fills the calendar event from the live buffing list (top two plate screws in "
    + "Curtis's order, top two visible hardware). The only thing the note may carry is a deadline when a restring depends "
    + "on hardware (rule 10), written as 'DEADLINE: <piano> hardware ready by <day time> - <tech> starts <phase>'. "
    + "You also get each technician's WEEKLY REPORT (their own account of this week, per piano: DONE / CONTINUE NEXT WEEK "
    + "(with days to finish) / NOT STARTED). When a note asks you to re-check a report or redo a tech's week from it, rebuild "
    + "that tech's days from the report: CONTINUE NEXT WEEK items first with their days-to-finish, then NOT STARTED items, "
    + "DONE items need no time and their existing blocks come OFF; keep standing rules and fixed blocks. A tech with no report cannot be rebuilt — say so in questions. "
    + "CARD PHASES ARE THE CURRENT TRUTH (Mark 10/30): you also get each scheduled piano's live card phase. The plan's own lane "
    + "notes and reportOverrides are the draft's EARLIER reasoning, not evidence — when the card phase or the report you are "
    + "given now disagrees with them, the fresh data wins: drop or rewrite the stale override and never quote it as a reason. "
    + "When a tech you are changing (or a note asks you to re-check) has a lane for work the card has already moved PAST "
    + "(e.g. Restringing blocks while the card says Chip Tuning), that work is done — take those blocks off and fill the time "
    + "per the notes / report; if nothing says what comes next, leave the time open and ask in questions. For techs no note "
    + "touches, do not change their days — add a bottleneck naming the stale lane instead.";
  const reportsTxt = reports
    ? `TECH WEEKLY REPORTS (filed under ${reports.label}):\n` + Object.entries(reports.byTech).map(([n, t]) => `${n}: ${t}`).join("\n") + "\n\n"
    : "TECH WEEKLY REPORTS: (none found on the year tab)\n\n";
  const userMsg = `STANDING RULES:\n${rules.map(r => "- " + r).join("\n") || "(none yet)"}\n\n`
    + reportsTxt
    + (tuneQueue ? `TUNING QUEUE (marked Needs tuning on the Showroom Tuning Check, not booked yet, in order):\n${tuneQueue}\n\n` : "")
    + (cardPhases ? `CARD PHASES (live from the Store Map, for every piano the plan schedules):\n${cardPhases}\n\n` : "")
    + (plateHolds ? `PLATES NOT READY (plate out, not yet refinished — do not schedule stringing):\n${plateHolds}\n\n` : "")
    + (timeOff.text ? `APPROVED TIME OFF (from the Time Off requests — schedule NOTHING for that technician on a whole day off; on a partial day leave the stated hours empty):\n${timeOff.text}\n\n` : "")
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
  // merge the returned techs into the current plan (by name, case-insensitive);
  // a full `plan` from the model is still accepted as before
  if (!out.plan && Array.isArray(out.changed_techs)) {
    const merged = JSON.parse(JSON.stringify(plan));
    merged.techs = Array.isArray(merged.techs) ? merged.techs : [];
    const key = (n: unknown) => String(n || "").trim().toLowerCase();
    const first = (n: unknown) => key(n).split(/\s+/)[0];
    for (const t of out.changed_techs) {
      if (!t || typeof t !== "object" || !t.name) continue;
      // "Myrrhanda Lamping" from the model is the plan's "Myrrhanda" — exact name first, then first name
      let i = merged.techs.findIndex((x: any) => key(x.name) === key(t.name));
      if (i < 0) i = merged.techs.findIndex((x: any) => first(x.name) === first(t.name));
      if (i >= 0) merged.techs[i] = { ...merged.techs[i], ...t, name: merged.techs[i].name }; else merged.techs.push(t);
    }
    if (Array.isArray(out.bottlenecks)) merged.bottlenecks = out.bottlenecks;
    if (Array.isArray(out.reportOverrides)) merged.reportOverrides = out.reportOverrides;
    // TECH OUT (Mark 10/23): the model's "removed Ricardo entirely" never
    // reached the plan — it narrated the removal in `changes` but returned
    // no empty tech, so the merge kept his old days. Clear every tech named
    // in cleared_techs, and any tech the change log says is out / cleared /
    // removed, and say so in the change log.
    const blocksOf = (t: any) => (Array.isArray(t.days) ? t.days : []).reduce((n: number, d: any) => n + (Array.isArray(d) ? d.length : 0), 0);
    const clearTech = (t: any, why: string) => {
      const had = blocksOf(t);
      t.days = [[], [], [], [], []]; t.hours = "";
      if (!/^\s*out\b/i.test(String(t.who || ""))) t.who = "OUT this week — " + why;
      return had;
    };
    const OUT_RE = /\b(out all week|out this week|on vacation|cleared (?:his|her|their) week|clear(?:ed)? (?:the )?week|removed (?:him|her|them )?(?:entirely|from (?:his|her|their) schedule|from the schedule)|no work (?:is )?scheduled|not scheduled this week|do not schedule)\b/i;
    const changes: string[] = Array.isArray(out.changes) ? out.changes.map((c: any) => String(c)) : [];
    const named = new Set((Array.isArray(out.cleared_techs) ? out.cleared_techs : []).map(key));
    for (const t of merged.techs) {
      const k = key(t.name), f = first(t.name);
      const listed = named.has(k) || [...named].some((n) => n.split(/\s+/)[0] === f);
      const narrated = changes.some((c) => OUT_RE.test(c) && new RegExp("\\b" + f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "i").test(c));
      if (!listed && !narrated) continue;
      const had = clearTech(t, listed ? "per the note" : "per the note (the change log said so)");
      if (had) changes.push(`${t.name}: cleared ${had} remaining block${had === 1 ? "" : "s"} — the week is empty (technician out).`);
    }
    // approved whole days off are binding (Mark 10/23): empty them whatever the model did
    for (const t of merged.techs) {
      const offDays = timeOff.days[first(t.name)];
      if (!offDays || !Array.isArray(t.days)) continue;
      let cleared = 0;
      for (const di of offDays) { if (Array.isArray(t.days[di]) && t.days[di].length) { cleared += t.days[di].length; t.days[di] = []; } }
      if (cleared) changes.push(`${t.name}: cleared ${cleared} block${cleared === 1 ? "" : "s"} on approved time off (${[...offDays].sort().map(d => ["Mon", "Tue", "Wed", "Thu", "Fri"][d]).join(", ")}).`);
    }
    out.changes = changes;
    out.plan = merged;
  }
  // The model sometimes returns `plan` as a JSON STRING instead of an object
  // (9/18: Mark's second notes pass). JSON.stringify of that string double-
  // encoded the plan, the bridge accepted the valid string literal, and every
  // reader then failed to parse the broken text inside — the Planner showed
  // the Aug 10 snapshot. Normalize + validate here; never save a plan that is
  // not an object with technicians.
  if (typeof out.plan === "string") { try { out.plan = JSON.parse(out.plan); } catch { out.plan = null; } }
  const okPlan = out.plan && typeof out.plan === "object" && !Array.isArray(out.plan)
    && Array.isArray(out.plan.techs) && out.plan.techs.length
    && out.plan.techs.every((t: any) => t && typeof t === "object" && t.name && (t.days == null || Array.isArray(t.days)));
  if (!okPlan) {
    await logAdjustment({ by: String(body.by || "Brigham"), kind: "schedule notes",
      input: (globalTxt ? "GLOBAL: " + globalTxt + "\n" : "") + notesTxt,
      outcome: "AI returned a malformed plan (not an object with technicians) — NOTHING was saved; the previous proposal stands. Re-apply the notes." + (aj.stop_reason ? " [stop_reason: " + aj.stop_reason + "]" : ""),
      rules: [], questions: [], saved: false, saveErr: "malformed plan from the model" });
    return finish({ error: "The AI revision came back malformed, so nothing was saved — the current proposal is untouched. Tap Apply adjustments once more." }, 502);
  }
  out.plan.bottlenecks = normalizeBottlenecks(out.plan.bottlenecks);   // [title, body] pairs only (9/25)
  if (!out.plan.weekStart && plan.weekStart) out.plan.weekStart = plan.weekStart;
  if (!out.plan.week && plan.week) out.plan.week = plan.week;

  /* Never persist a plan we have not looked at (Walter 9/18). On 9/18 this
   * saved a revision with week:"", weekStart:"" and zero techs — the store was
   * emptied and the Planner fell back to the static August snapshot on every
   * load. A truncated or malformed tool result is a normal failure mode
   * (max_tokens against a full week), so it is checked rather than trusted.
   * The stop_reason tells us specifically when the model ran out of room. */
  const revised = out?.plan;
  const techCount = Array.isArray(revised?.techs) ? revised.techs.length : 0;
  const bad: string[] = [];
  if (!revised) bad.push("no plan returned");
  if (!String(revised?.weekStart || "").trim()) bad.push("no weekStart");
  if (!String(revised?.week || "").trim()) bad.push("no week");
  if (!techCount) bad.push("no technicians");
  if (bad.length) {
    const truncated = aj.stop_reason === "max_tokens";
    const why = bad.join(", ") + (truncated ? " (the model hit max_tokens — the plan came back truncated)" : "");
    await logAdjustment({ by: String(body.by || "Brigham"), kind: "schedule notes",
      input: (globalTxt ? "GLOBAL: " + globalTxt + "\n" : "") + notesTxt,
      outcome: "REFUSED — revision discarded: " + why, rules: [], questions: [],
      saved: false, saveErr: why });
    return finish({ error: "The revision came back incomplete (" + why
      + "), so nothing was saved and your existing plan is untouched. Try again, "
      + "or split your notes into smaller batches.", saved: false, discarded: true }, 502);
  }

  // persist: rules to the sheet, revised plan to the bridge
  await appendRules(out.rules_extracted || [], String(body.by || "Brigham"));
  let saved = false, saveErr = "";
  try {
    const sv = await fetch(BRIDGE, { method: "POST", redirect: "follow",
      headers: { "content-type": "text/plain;charset=utf-8" },
      // aiRevised flags the CONTENT as model-written while the name stays the
      // human who asked for it — they clicked apply, so this legitimately
      // overwrites their own plan and must not trip the bot guard. Without the
      // flag the history reads as if Mark typed the whole week himself.
      body: JSON.stringify({ pin: APP_KEY, key: APP_KEY, action: "saveproposal",
        week: out.plan.week, weekStart: out.plan.weekStart, plan: JSON.stringify(out.plan),
        aiRevised: true, aiModel: MODEL,
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
