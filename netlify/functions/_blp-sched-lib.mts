/** Shared helpers for the scheduled BLP shop jobs (Netlify scheduled functions run in UTC). */
import * as crypto from "node:crypto";
export const REPORT_SHEET = "11RoeVRETag5rZYX6_tEH-rf6x8JL0JeZU0P5AT0WI-I";
export const BRIDGE = "https://script.google.com/macros/s/AKfycbxY4BKnr_Tr0iCTc9itCWhNYLvgszmkI1IoYSkbBWpyAqRtWI-yaUkJQjcVdgG58KXt/exec";
export const SITE = "https://blpsalesapp.netlify.app";
export const KEY = () => process.env.BLP_APP_ACCESS_KEY || "pianoman";
let tokenCache: { token: string; exp: number } | null = null;
export async function googleToken(): Promise<string> {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || "";
  const key = (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
  if (!email || !key) throw new Error("Google service account env not set");
  const now = Math.floor(Date.now() / 1000);
  if (tokenCache && tokenCache.exp > now + 60) return tokenCache.token;
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const header = b64({ alg: "RS256", typ: "JWT" });
  const claims = b64({ iss: email, scope: "https://www.googleapis.com/auth/spreadsheets", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 });
  const signer = crypto.createSign("RSA-SHA256"); signer.update(`${header}.${claims}`);
  const signature = signer.sign(key).toString("base64url");
  const res = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${header}.${claims}.${signature}` }) });
  if (!res.ok) throw new Error(`Google token exchange failed (${res.status})`);
  const j = (await res.json()) as { access_token: string; expires_in: number };
  tokenCache = { token: j.access_token, exp: now + j.expires_in };
  return j.access_token;
}
export async function sheetGet(id: string, range: string): Promise<string[][]> {
  const t = await googleToken();
  const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${encodeURIComponent(range)}?majorDimension=ROWS`, { headers: { Authorization: "Bearer " + t } });
  if (!r.ok) throw new Error(`sheet read ${range} failed (${r.status})`);
  return ((await r.json()) as { values?: string[][] }).values || [];
}
export async function sheetAppend(id: string, tab: string, row: unknown[]) {
  const t = await googleToken();
  await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${encodeURIComponent(`'${tab}'!A1`)}:append?valueInputOption=RAW`,
    { method: "POST", headers: { Authorization: "Bearer " + t, "Content-Type": "application/json" }, body: JSON.stringify({ values: [row] }) });
}
export async function notify(name: string, message: string): Promise<{ ok: boolean; sent?: boolean; reason?: string }> {
  for (let a = 0; a < 2; a++) {
    try {
      const r = await fetch(SITE + "/.netlify/functions/request-notify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ key: KEY(), name, message }) });
      const j = (await r.json()) as { ok: boolean; sent?: boolean; reason?: string };
      if (j && (j.sent || j.reason)) return j;
    } catch { /* retry */ }
    await new Promise(res => setTimeout(res, 15000));
  }
  return { ok: false, sent: false, reason: "relay unreachable" };
}
/** Bridge GET with retry through Google's deploy-time ping/HTML answers. */
export async function bridgeGet(qs: string, want: (j: any) => boolean, tries = 5): Promise<any> {
  for (let a = 0; a < tries; a++) {
    try {
      const r = await fetch(BRIDGE + "?" + qs, { redirect: "follow", signal: AbortSignal.timeout(45000) });
      const txt = await r.text();
      let j: any = null; try { j = JSON.parse(txt); } catch { j = null; }
      if (j && want(j)) return j;
    } catch { /* retry */ }
    await new Promise(res => setTimeout(res, 20000));
  }
  return null;
}
export function denver(d = new Date()) {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", weekday: "short", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", hour12: false }).formatToParts(d);
  const g = (t: string) => p.find(x => x.type === t)?.value || "";
  return { weekday: g("weekday"), y: +g("year"), m: +g("month"), d: +g("day"), h: +g("hour") % 24, min: +g("minute") };
}
export const denverStamp = (d = new Date()) => new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(d);

/* Bottleneck entries are [title, body] pairs — the Planner renders bn[0] as
 * the heading and bn[1] as the text. On 9/25 a revision came back with 33
 * plain STRINGS in plan.bottlenecks (per-piano reconciliation notes), so the
 * Manager Clarification list showed one-letter headings ("T", "2", "1"…).
 * Coerce anything that is not a pair into one; drop empties. */
export function normalizeBottlenecks(list: unknown): string[][] {
  if (!Array.isArray(list)) return [];
  const out: string[][] = [];
  for (const b of list) {
    if (Array.isArray(b)) { const t = String(b[0] ?? "").trim(); if (t) out.push([t, String(b[1] ?? "").trim()]); continue; }
    if (b && typeof b === "object") { const o = b as Record<string, unknown>; const t = String(o.title ?? o.name ?? "").trim(); if (t) out.push([t, String(o.body ?? o.text ?? o.detail ?? "").trim()]); continue; }
    const str = String(b ?? "").trim(); if (!str) continue;
    const m = /^(.{6,90}?)(?:\s+[—–-]\s+|:\s+)(.+)$/s.exec(str);
    out.push(m ? [m[1].trim(), m[2].trim()] : [str.slice(0, 90), str.length > 90 ? str : ""]);
  }
  return out;
}

/** Pianos whose plate is out and not yet refinished (Scheduling Rule 94, Walter 10/13):
 * card PLATE STATUS Removed / Plate storage — BEFORE / At Curtis Harper. The weekly
 * draft gave Alex "Steinway 3536 - Restringing" with its plate still in BEFORE storage;
 * the Planner never saw plate status. Approve holds such blocks too. "" if unreadable. */
export async function plateHoldText(): Promise<string> {
  try {
    const r = await fetch("https://blpstoremap.netlify.app/api/data", { signal: AbortSignal.timeout(20000) });
    const d = await r.json() as { pianos?: { make?: string; serial?: string; phase?: string; plateStatus?: string }[] };
    const held = (d.pianos || []).filter(p => p.serial && /^(removed|plate storage\s*\W*\s*before|at curtis)/i.test(String(p.plateStatus || "").trim()));
    return held.map(p => `${String(p.make || "").trim()} ${p.serial} (${p.phase || "no phase"}): ${String(p.plateStatus).trim()}`).join("\n");
  } catch { return ""; }
}

/** Plates back from Curtis Harper (Mark 10/30): card PLATE STATUS "Plate storage —
 * AFTER" — each one's restringing is Lupita's next assignment, in shop-queue order.
 * One line per piano with its phase and queue #. "" if unreadable or none. */
export async function plateReadyText(): Promise<string> {
  try {
    const r = await fetch("https://blpstoremap.netlify.app/api/data", { signal: AbortSignal.timeout(20000) });
    const d = await r.json() as { pianos?: { make?: string; serial?: string; phase?: string; plateStatus?: string; queuePos?: number; active?: boolean }[] };
    const ready = (d.pianos || []).filter(p => p.active && p.serial && /^plate storage\s*\W*\s*after/i.test(String(p.plateStatus || "").trim()))
      .sort((a, b) => (a.queuePos || 999) - (b.queuePos || 999));
    return ready.map(p => `${String(p.make || "").trim()} ${p.serial} (${p.phase || "no phase"}${p.queuePos ? ", queue #" + p.queuePos : ""})`).join("\n");
  } catch { return ""; }
}

/** Which technicians a notes run may change (Mark 10/30): the techs the notes
 * are written for, any tech named inside a note's text ("Garrett: swap with
 * Jake" touches Jake), and everyone when there is a GLOBAL note. On 10/30 the
 * model took Hunter off Steinway 451912 — no note named him — because "someone
 * needs to continue the CAP" Avery had just left. Keys are plan tech names,
 * lower-cased; null = no limit. */
export function allowedTechs(plan: any, notes: Record<string, unknown>, globalTxt: string): Set<string> | null {
  if (String(globalTxt || "").trim()) return null;
  const key = (n: unknown) => String(n || "").trim().toLowerCase();
  const first = (n: unknown) => key(n).split(/\s+/)[0];
  const techs: string[] = (plan?.techs || []).map((t: any) => key(t.name)).filter(Boolean);
  const out = new Set<string>();
  const noteText = Object.entries(notes || {}).filter(([, v]) => String(v || "").trim());
  for (const [who] of noteText) {
    const k = key(who), f = first(who);
    for (const t of techs) if (t === k || t.split(/\s+/)[0] === f) out.add(t);
  }
  const blob = noteText.map(([, v]) => String(v)).join("\n");
  for (const t of techs) {
    const f = t.split(/\s+/)[0];
    if (f.length >= 3 && new RegExp("\\b" + f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "i").test(blob)) out.add(t);
  }
  return out;
}

/** Pianos with two technicians on the same day (Mark 10/30): one tech per
 * piano unless a note pairs them. Serial = the first 4+ character token of
 * digits (letters allowed) in the block title. Returns one line per piano. */
export function doubleStaffed(plan: any): string[] {
  const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];
  const serialOf = (title: string) => (String(title || "").match(/\b(?=[A-Z0-9-]*\d)[A-Z0-9][A-Z0-9-]{3,}\b/i) || [""])[0].toUpperCase();
  const byPiano = new Map<string, { title: string; days: Map<number, Set<string>> }>();
  for (const t of (plan?.techs || [])) {
    (t.days || []).forEach((day: any[], di: number) => (day || []).forEach((b: any[]) => {
      const kind = String((b || [])[2] || ""), title = String((b || [])[3] || "");
      if (/^(misc|tune|qc)$/i.test(kind)) return;   // standing blocks, tunings and QCs ride along with the shop work
      const sn = serialOf(title); if (!sn) return;
      const e = byPiano.get(sn) || { title: title.replace(/\s[-–—]\s.*$/, ""), days: new Map() };
      (e.days.get(di) || e.days.set(di, new Set()).get(di)!).add(String(t.name || "").split(/\s+/)[0]);
      byPiano.set(sn, e);
    }));
  }
  const out: string[] = [];
  for (const [, e] of byPiano) {
    const hits = [...e.days.entries()].filter(([, who]) => who.size > 1);
    if (!hits.length) continue;
    const who = new Set<string>(); hits.forEach(([, w]) => w.forEach(x => who.add(x)));
    out.push(`${e.title} — ${[...who].join(" + ")} on ${hits.map(([d]) => DAYS[d]).join(", ")}`);
  }
  return out;
}

/** The Tuning Queue (Walter 10/14): pianos Korban marked "Needs tuning" on the
 * Showroom Tuning Check that nobody has booked — computed by the Store Map's
 * /api/data (tuningQueue), ⚡ ASAP first, then walk order. They fill Korban's
 * open tuning slots after chip tunings and card-phase tunings. "" if unreadable. */
export async function tuningQueueText(): Promise<string> {
  try {
    type TQ = { tuningQueue?: { rank: number; serial: string; piano: string; spot: string; asap: boolean; note: string }[]; tuningQueuePending?: string };
    let d: TQ = {};
    // a freshly started data instance answers before the tuning calendar is in — ask again
    for (let a = 0; a < 3; a++) {
      const r = await fetch("https://blpstoremap.netlify.app/api/data?scope=active", { signal: AbortSignal.timeout(20000) });
      d = await r.json() as TQ;
      if (d.tuningQueue || !d.tuningQueuePending) break;
      await new Promise(res => setTimeout(res, 15000));
    }
    return (d.tuningQueue || []).map(q => `${q.rank}. ${q.asap ? "⚡ ASAP " : ""}${q.piano} #${q.serial} (spot ${q.spot || "?"})${q.note ? " — " + q.note : ""}`).join("\n");
  } catch { return ""; }
}
