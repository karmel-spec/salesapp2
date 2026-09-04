/**
 * Store Map — PHASE CHECKLISTS + MINI-QC LOOP (CAP pilot, Brigham 9/3).
 *
 * GET  ?key&serial&phase          → checklist content (Phase Checklists tab,
 *                                   cached 10 min) + per-piano check state +
 *                                   any open QC request for serial+phase
 * POST {key, op:'check',   serial, phase, step, done, by}
 * POST {key, op:'request', serial, piano, phase, next_phase, by}
 *        → creates a pending QC request (one per serial+phase) and texts
 *          the shop manager a deep link; escalation cron covers silence.
 * POST {key, op:'verdict', id, item, verdict:'pass'|'fail', note, manager}
 * POST {key, op:'finalize', id, outcome:'pass'|'rework', manager, pin}
 *        pass   → advance the phase via the durable relay + text the tech
 *        rework → task-board card with the failed items + text the tech
 */
import * as crypto from "node:crypto";
import { loadSettings } from "./app-settings.mts";

const SHEET_ID = "11RoeVRETag5rZYX6_tEH-rf6x8JL0JeZU0P5AT0WI-I";
const APP_URL = "https://blpstoremap.netlify.app";
const ALLOW = [APP_URL, "http://localhost:8641"];

let tokenCache: { token: string; exp: number } | null = null;
async function googleToken(): Promise<string> {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || "";
  const key = (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
  if (!email || !key) throw new Error("service account env not set");
  const now = Math.floor(Date.now() / 1000);
  if (tokenCache && tokenCache.exp > now + 60) return tokenCache.token;
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const header = b64({ alg: "RS256", typ: "JWT" });
  const claims = b64({ iss: email, scope: "https://www.googleapis.com/auth/spreadsheets.readonly",
    aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 });
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  const signature = signer.sign(key).toString("base64url");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${header}.${claims}.${signature}` }),
  });
  if (!res.ok) throw new Error("token " + res.status);
  const j = (await res.json()) as { access_token: string; expires_in: number };
  tokenCache = { token: j.access_token, exp: now + j.expires_in };
  return j.access_token;
}

function sb() {
  const key = process.env.SUPABASE_SERVICE_KEY || "";
  return { apikey: key, Authorization: "Bearer " + key, "Content-Type": "application/json" };
}
const SB = () => process.env.SUPABASE_URL || "";

function cors(origin: string | null) {
  const o = origin && ALLOW.includes(origin) ? origin : ALLOW[0];
  return { "access-control-allow-origin": o, "access-control-allow-headers": "content-type",
    "content-type": "application/json" };
}
const json = (o: unknown, headers: Record<string, string>, status = 200) =>
  new Response(JSON.stringify(o), { status, headers });

let clCache: { at: number; rows: string[][]; gloss: string[][] } | null = null;
async function checklistRows(): Promise<{ rows: string[][]; gloss: string[][] }> {
  if (clCache && Date.now() - clCache.at < 600000) return clCache;
  const t = await googleToken();
  const ranges = ["'Phase Checklists'!A2:H500", "'Glossary'!A2:C300"];
  const r = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values:batchGet?` +
      ranges.map((x) => "ranges=" + encodeURIComponent(x)).join("&"),
    { headers: { Authorization: "Bearer " + t } });
  const d = (await r.json()) as { valueRanges: Array<{ values?: string[][] }> };
  const rows = (d.valueRanges[0]?.values || []).filter((v) => v[0]);
  const gloss = (d.valueRanges[1]?.values || []).filter((v) => v[0] && v[1]);
  clCache = { at: Date.now(), rows, gloss };
  return clCache;
}

async function textByName(name: string, message: string) {
  try {
    await fetch("https://blpsalesapp.netlify.app/.netlify/functions/request-notify", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: process.env.BLP_APP_ACCESS_KEY || "", name, message }),
    });
  } catch { /* best effort */ }
}

export default async (req: Request) => {
  const headers = cors(req.headers.get("origin"));
  if (req.method === "OPTIONS") return new Response("", { headers });
  const APP_KEY = process.env.BLP_APP_ACCESS_KEY || "";
  if (!SB() || !process.env.SUPABASE_SERVICE_KEY) return json({ error: "not configured" }, headers, 503);

  if (req.method === "GET") {
    const u = new URL(req.url);
    if ((u.searchParams.get("key") || "") !== APP_KEY) return json({ error: "unauthorized" }, headers, 401);
    const serial = u.searchParams.get("serial") || "";
    const phase = u.searchParams.get("phase") || "";
    const { rows, gloss } = await checklistRows();
    const items = rows.filter((v) => v[0] === phase)
      .map((v, i) => ({ i, kind: v[1] || "work", variant: (v[2] || "all").toLowerCase(),
        section: v[3] || "", text: v[4] || "", detail: v[5] || "",
        handbook: v[6] || "", video: v[7] || "" }));
    let checks: unknown[] = [], request: unknown = null;
    if (serial) {
      const [cr, qr] = await Promise.all([
        fetch(`${SB()}/rest/v1/phase_checks?serial=eq.${encodeURIComponent(serial)}&phase=eq.${encodeURIComponent(phase)}`, { headers: sb() }),
        fetch(`${SB()}/rest/v1/qc_requests?serial=eq.${encodeURIComponent(serial)}&phase=eq.${encodeURIComponent(phase)}&status=in.(pending,rework)&order=id.desc&limit=1`, { headers: sb() }),
      ]);
      checks = await cr.json();
      request = ((await qr.json()) as unknown[])[0] || null;
    }
    return json({ ok: true, items, checks, request,
      glossary: gloss.map((v) => ({ term: v[0], def: v[1], img: v[2] || "" })) }, headers);
  }

  let p: Record<string, any>;
  try { p = await req.json(); } catch { return json({ error: "bad json" }, headers, 400); }
  if (p.key !== APP_KEY) return json({ error: "unauthorized" }, headers, 401);
  const op = String(p.op || "");
  const now = new Date().toISOString();

  if (op === "check") {
    const row = { serial: String(p.serial), phase: String(p.phase), step: Number(p.step) };
    if (p.done) {
      const r = await fetch(`${SB()}/rest/v1/phase_checks?on_conflict=serial,phase,step`, {
        method: "POST", headers: { ...sb(), Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({ ...row, done_by: String(p.by || ""), at: now,
          skipped: !!p.skipped, note: String(p.note || "").slice(0, 200) }),
      });
      if (!r.ok) return json({ error: "save failed " + r.status }, headers, 502);
    } else {
      await fetch(`${SB()}/rest/v1/phase_checks?serial=eq.${encodeURIComponent(row.serial)}&phase=eq.${encodeURIComponent(row.phase)}&step=eq.${row.step}`,
        { method: "DELETE", headers: sb() });
    }
    return json({ ok: true }, headers);
  }

  if (op === "request") {
    // one pending request per serial+phase
    const ex = await (await fetch(`${SB()}/rest/v1/qc_requests?serial=eq.${encodeURIComponent(p.serial)}&phase=eq.${encodeURIComponent(p.phase)}&status=eq.pending&limit=1`, { headers: sb() })).json() as unknown[];
    if (ex.length) return json({ ok: true, id: (ex[0] as { id: number }).id, existing: true }, headers);
    const ins = await fetch(`${SB()}/rest/v1/qc_requests`, {
      method: "POST", headers: { ...sb(), Prefer: "return=representation" },
      body: JSON.stringify({ serial: String(p.serial), piano: String(p.piano || ""),
        phase: String(p.phase), next_phase: String(p.next_phase || ""), requested_by: String(p.by || "") }),
    });
    if (!ins.ok) return json({ error: "queue failed " + ins.status }, headers, 502);
    const id = ((await ins.json()) as Array<{ id: number }>)[0].id;
    // TRAINING PERIOD (Brigham 9/3 → 10/3): Brigham performs EVERY mini-QC
    // himself to train the managers; Karmel is copied on each request so she
    // can video the inspection for the training library. After 10/3 requests
    // go back to the shop manager.
    // inspector + video-copy + escalation window come from the Settings page
    let inspector = "Mark Hales", videoCopy = "", escMin = "30";
    try {
      const st = (await loadSettings()).settings;
      inspector = st.qc_inspector || inspector;
      videoCopy = st.qc_video_copy || "";
      escMin = st.qc_escalate_minutes || escMin;
    } catch { /* defaults */ }
    const who = String(p.by || "a tech").split(" ")[0];
    const what = `${p.phase} on ${p.piano || "#" + p.serial}`;
    await textByName(inspector,
      `🔍 Mini-QC requested — ${what} by ${who}. Inspect: ${APP_URL}/#qc=${id} (escalates after ${escMin} min)`);
    if (videoCopy) await textByName(videoCopy,
      `🎥 Mini-QC to video for manager training — ${inspector} was just asked to inspect ${what} (requested by ${who}). ${APP_URL}/#qc=${id}`);
    return json({ ok: true, id }, headers);
  }

  if (op === "verdict") {
    const r0 = await (await fetch(`${SB()}/rest/v1/qc_requests?id=eq.${Number(p.id)}&select=verdicts`, { headers: sb() })).json() as Array<{ verdicts: Record<string, unknown> }>;
    if (!r0.length) return json({ error: "no such request" }, headers, 404);
    const v = r0[0].verdicts || {};
    v[String(p.item)] = { verdict: p.verdict === "pass" ? "pass" : "fail",
      note: String(p.note || "").slice(0, 300), by: String(p.manager || ""), at: now };
    const r = await fetch(`${SB()}/rest/v1/qc_requests?id=eq.${Number(p.id)}`, {
      method: "PATCH", headers: sb(),
      body: JSON.stringify({ verdicts: v, manager: String(p.manager || ""), updated: now }),
    });
    return r.ok ? json({ ok: true, verdicts: v }, headers) : json({ error: "save failed" }, headers, 502);
  }

  if (op === "finalize") {
    const rows = await (await fetch(`${SB()}/rest/v1/qc_requests?id=eq.${Number(p.id)}`, { headers: sb() })).json() as any[];
    if (!rows.length) return json({ error: "no such request" }, headers, 404);
    const q = rows[0];
    const outcome = p.outcome === "pass" ? "passed" : "rework";
    await fetch(`${SB()}/rest/v1/qc_requests?id=eq.${Number(p.id)}`, {
      method: "PATCH", headers: sb(),
      body: JSON.stringify({ status: outcome, manager: String(p.manager || ""), updated: now }),
    });
    const first = String(q.requested_by || "").split(" ")[0] || "team";
    // keep the scorecard's QC Log fed: record the inspection outcome there too
    fetch("https://script.google.com/macros/s/AKfycbxY4BKnr_Tr0iCTc9itCWhNYLvgszmkI1IoYSkbBWpyAqRtWI-yaUkJQjcVdgG58KXt/exec", {
      method: "POST", headers: { "content-type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ pin: "pianoman", action: "miniqc", serial: q.serial, phase: q.phase,
        result: outcome === "passed" ? "pass" : "fix",
        note: outcome === "passed" ? "mini-QC rail pass" : "rework assigned",
        user: { name: String(p.manager || "Mini-QC"), email: "" } }),
    }).catch(() => {});
    if (outcome === "passed") {
      // advance the phase through the durable relay (loss-proof)
      await fetch("https://blpsalesapp.netlify.app/.netlify/functions/pianolog-write", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ relayKey: APP_KEY, pin: String(p.pin || "pianoman"), action: "setphase",
          serial: q.serial, phase: q.next_phase,
          user: { name: (p.manager || "Manager") + " (mini-QC pass)", email: "" } }),
      }).catch(() => {});
      await textByName(q.requested_by,
        `✅ Mini-QC PASSED — ${q.phase} on ${q.piano || "#" + q.serial} (${String(p.manager || "manager").split(" ")[0]}). Phase advanced to ${q.next_phase}. Nice work.`);
    } else {
      const failed = Object.entries((q.verdicts || {}) as Record<string, any>)
        .filter(([, v]) => v.verdict === "fail")
        .map(([k, v]) => `✗ ${k}${v.note ? " — " + v.note : ""}`);
      await fetch("https://blpsalesapp.netlify.app/.netlify/functions/taskboard-write", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ key: APP_KEY, op: "add", owner: q.requested_by,
          text: `🔁 REWORK — ${q.phase} on ${q.piano || "#" + q.serial} (mini-QC by ${String(p.manager || "").split(" ")[0]}):\n` +
            (failed.join("\n") || "see manager"),
          serial: q.serial, from: String(p.manager || "Mini-QC"),
          user: { name: p.manager || "Mini-QC", email: "" } }),
      }).catch(() => {});
      await textByName(q.requested_by,
        `🔁 Mini-QC on ${q.phase} — ${q.piano || "#" + q.serial}: ${failed.length} item${failed.length === 1 ? "" : "s"} need rework (card on your task board). Clock in under 🔁 Rework, fix, then re-request QC.`);
    }
    return json({ ok: true, status: outcome }, headers);
  }

  return json({ error: "bad op" }, headers, 400);
};
