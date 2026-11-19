/**
 * Paced SalesCaptain history replay (Brigham 11/18): recover messages the
 * stuck API sync never logged (10/2 → 11/18), and any later recorded gap.
 *
 * Works conversation by conversation and saves its place after each one
 * (Blobs "salescaptain-api" → "replay"), so a run that hits the time budget
 * or Google's quota just continues on the next call instead of starting over
 * (the failure that kept the sync stuck for seven weeks).
 *
 * Every message goes to /api/salescaptain/inbound as a backfill:
 *  - backfill → no team ping, no Arnold wake, no last-contact bump
 *  - noCreate → contacts not in the Leads Log are skipped, never created
 *  - already-logged messages are answered from the cached copy (no Sheets read)
 *  - each newly logged message costs a live read + write, so they are spaced
 *    PACE_POSTED_MS apart (~15 reads/min, well under the shared 60/min).
 */
import { getStore } from "@netlify/blobs";
import { scConfigured, scConversationsSince, scMessagesSince, type ScConversation } from "./salescaptain-api";
import { messagePayload } from "./salescaptain-api-sync-run";

const APP_URL = process.env.URL || "https://blpsalesapp.netlify.app";
const INTAKE_KEY = process.env.BLP_ARNOLD_ACCESS_KEY || "";
const RUN_BUDGET_MS = 10 * 60_000;
const PACE_POSTED_MS = 4000;
const PACE_DUP_MS = 150;
const MAX_ERRORS = 3;
const LOCK_TTL_MS = 14 * 60_000;

type Conv = Pick<ScConversation, "conversation_id" | "contact_id" | "contact_name" | "contact_number" | "contact_email" | "assigned_to">;
export interface ReplayState {
  from: string; to: string; noCreate: boolean;
  convs: Conv[]; next: number; done: boolean; stopped?: string;
  totals: { messages: number; posted: number; duplicates: number; skipped: number; errors: number; calls: number };
  samples: string[]; errorsSeen: string[];
  startedAt: string; updatedAt: string;
}

const store = () => getStore({ name: "salescaptain-api", consistency: "strong" });

/** Build the conversation list for a new replay window (replaces any previous replay state). */
export async function startReplay(fromMs: number, toMs: number, noCreate = true): Promise<ReplayState> {
  if (!scConfigured()) throw new Error("SalesCaptain API env not set");
  const { list } = await scConversationsSince(fromMs, 5000);
  const state: ReplayState = {
    from: new Date(fromMs).toISOString(), to: new Date(toMs).toISOString(), noCreate,
    convs: list.map((c) => ({ conversation_id: c.conversation_id, contact_id: c.contact_id, contact_name: c.contact_name, contact_number: c.contact_number, contact_email: c.contact_email, assigned_to: c.assigned_to })),
    next: 0, done: list.length === 0,
    totals: { messages: 0, posted: 0, duplicates: 0, skipped: 0, errors: 0, calls: 0 },
    samples: [], errorsSeen: [],
    startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  await store().setJSON("replay", state);
  return state;
}

/** One budgeted pass. Returns the state; `more` = call again to continue. */
export async function continueReplay(): Promise<{ state: ReplayState | null; more: boolean; note?: string }> {
  if (!INTAKE_KEY) return { state: null, more: false, note: "BLP_ARNOLD_ACCESS_KEY not set" };
  const s = store();
  const state = (await s.get("replay", { type: "json" })) as ReplayState | null;
  if (!state) return { state: null, more: false, note: "no replay started" };
  if (state.done) return { state, more: false, note: "already done" };
  const t0 = Date.now();
  const lock = (await s.get("replay-lock", { type: "json" }).catch(() => null)) as { at?: number } | null;
  if (lock?.at && t0 - lock.at < LOCK_TTL_MS) return { state, more: false, note: "another replay pass is running" };
  const runId = `${t0}`;
  await s.setJSON("replay-lock", { at: t0, id: runId });
  state.stopped = undefined;
  state.totals.calls++;
  const fromMs = Date.parse(state.from), toMs = Date.parse(state.to);
  let errors = 0;
  try {
    while (state.next < state.convs.length) {
      if (Date.now() - t0 > RUN_BUDGET_MS) { state.stopped = "time budget (continues next pass)"; break; }
      const c = state.convs[state.next];
      let msgs;
      try { msgs = await scMessagesSince(c.conversation_id, fromMs); }
      catch (e) { errors++; state.errorsSeen.push(`messages ${c.contact_name}: ${String(e).slice(0, 120)}`); if (errors >= MAX_ERRORS) { state.stopped = "SalesCaptain errors"; break; } continue; }
      let convStop = "";
      for (const m of msgs) {
        const at = Date.parse(m.created_at);
        if (at < fromMs || at > toMs) continue;
        const { text, payload } = messagePayload(c as ScConversation, m, { backfill: true, noCreate: state.noCreate });
        const r = await fetch(`${APP_URL}/api/salescaptain/inbound`, { method: "POST", headers: { "content-type": "application/json", "x-blp-key": INTAKE_KEY }, body: JSON.stringify(payload) }).catch((e) => e as Error);
        if (r instanceof Error) { errors++; state.errorsSeen.push(`post ${c.contact_name}: ${String(r).slice(0, 120)}`); convStop = "network"; break; }
        const out = (await r.json().catch(() => ({}))) as { duplicate?: boolean; skipped?: string; matched?: boolean; error?: string; leadName?: string };
        if (!r.ok) {
          errors++;
          state.errorsSeen.push(`${r.status} ${c.contact_name}: ${(out.error || "").slice(0, 160)}`);
          convStop = /429|too many reads|quota|busy/i.test(out.error || "") ? "Sheets rate limit" : `HTTP ${r.status}`;
          break;
        }
        state.totals.messages++;
        if (out.duplicate) state.totals.duplicates++;
        else if (out.skipped || out.matched === false) state.totals.skipped++;
        else {
          state.totals.posted++;
          state.samples.push(`${m.created_at.slice(0, 16)} ${m.direction} ${out.leadName || c.contact_name}: ${text.replace(/\s+/g, " ").slice(0, 70)}`);
          if (state.samples.length > 60) state.samples.shift();
        }
        await new Promise((res) => setTimeout(res, out.duplicate || out.skipped || out.matched === false ? PACE_DUP_MS : PACE_POSTED_MS));
      }
      if (convStop) {
        // Retry this conversation next pass (already-logged messages come back as cheap duplicates).
        state.stopped = convStop;
        break;
      }
      state.next++;
      state.updatedAt = new Date().toISOString();
      await s.setJSON("replay", state);
    }
    if (state.next >= state.convs.length) state.done = true;
    state.totals.errors += errors;
    if (state.errorsSeen.length > 40) state.errorsSeen = state.errorsSeen.slice(-40);
    state.updatedAt = new Date().toISOString();
    await s.setJSON("replay", state);
    const more = !state.done && (!state.stopped || state.stopped.startsWith("time budget"));
    return { state, more };
  } finally {
    const l = (await s.get("replay-lock", { type: "json" }).catch(() => null)) as { id?: string } | null;
    if (l?.id === runId) await s.delete("replay-lock").catch(() => {});
  }
}
