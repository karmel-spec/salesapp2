/**
 * BLP Admin Training — progress store for blpadmintraining.netlify.app.
 * Sheet "BLP Admin Training" (TRAINING_SHEET_ID env or the constant below):
 *   Progress  | trainee | skillId | status | updatedAt | updatedBy
 *   Opened    | trainee | skillId | at
 *   Reps      | trainee | skillId | date | note | by | at
 *   Signoffs  | trainee | skillId | decision | note | by | at
 *   Questions | id | trainee | skillId | question | askedAt | by | answer | answeredBy | answeredAt
 *   Notes     | skillId | note | by | at
 *   Trainees  | email | name | start | hoursPerWeek | active
 *
 *   GET  ?fn=auth&key=…                      → {ok}
 *   GET  ?fn=state&trainee=email[&idToken|key] → {ok, state}
 *   GET  ?fn=all[&idToken]                   → {ok, states:{email:state}}   (owners/trainers)
 *   POST {action, trainee, idToken|key, …}   actions: opened|status|rep|signoff|question|answer|note|trainee
 *
 * Auth: Google ID token (map client) for BLP accounts, or key === BLP_APP_ACCESS_KEY.
 * Sign-offs, answers, notes and trainee edits need a VERIFIED owner/trainer identity.
 */
import * as crypto from "node:crypto";

const SHEET_ID = process.env.TRAINING_SHEET_ID || "17E2TMyIp5X1Ex9IkOHgODiN0qPeTVsP5R8zPJKrgSCc";
const ALLOW = [
  "https://blpadmintraining.netlify.app",
  "https://blpstoremap.netlify.app",
  "http://localhost:8944",
  "http://127.0.0.1:8944",
];
const MAP_GOOGLE_CLIENT_ID = "110628682621-v65mkaoanv87sp75ggdfcrglfr7bkr8p.apps.googleusercontent.com";
const SHOP_GOOGLE_CLIENT_ID = "118454775893-17u7t3glh8eu4kffhe7b42jl71apre4f.apps.googleusercontent.com";
const PIANOLOG_GOOGLE_CLIENT_ID = "523632876512-i2csml8jkg7c3knaone1sf0886oppfek.apps.googleusercontent.com";  // the training app signs in with this one
const ADMIN_DOMAIN = "brighamlarsonpianos.com";
const OWNERS = ["brigham@brighamlarsonpianos.com", "karmel@brighamlarsonpianos.com", "brighamlarson@gmail.com", "karmel.larson@gmail.com"];
const TRAINERS = ["melissa@brighamlarsonpianos.com"];
const STAFF = [...OWNERS, ...TRAINERS];
const TABS = {
  Progress: "A:E", Opened: "A:C", Reps: "A:F", Signoffs: "A:F", Questions: "A:I", Notes: "A:D", Trainees: "A:E",
};
const STATUSES = new Set(["learning", "practiced", "mastered", "refresh"]);
const DECISIONS = new Set(["mastered", "more", "refresh"]);

async function verifyGoogle(idToken: string): Promise<string | null> {
  if (!idToken) return null;
  const r = await fetch("https://oauth2.googleapis.com/tokeninfo?id_token=" + encodeURIComponent(idToken));
  if (!r.ok) return null;
  const info = (await r.json()) as Record<string, string>;
  if (![MAP_GOOGLE_CLIENT_ID, SHOP_GOOGLE_CLIENT_ID, PIANOLOG_GOOGLE_CLIENT_ID].includes(info.aud)) return null;
  if (String(info.email_verified) !== "true") return null;
  const email = String(info.email || "").toLowerCase();
  if (email.endsWith("@" + ADMIN_DOMAIN) || /\.blp@gmail\.com$/.test(email) || OWNERS.includes(email)) return email;
  return null;
}

let tokenCache: { token: string; exp: number } | null = null;
async function googleToken(): Promise<string> {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || "";
  const key = (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
  if (!email || !key) throw new Error("Google service account env not set");
  const now = Math.floor(Date.now() / 1000);
  if (tokenCache && tokenCache.exp > now + 60) return tokenCache.token;
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const header = b64({ alg: "RS256", typ: "JWT" });
  const claims = b64({ iss: email, scope: "https://www.googleapis.com/auth/spreadsheets", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 });
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  const signature = signer.sign(key).toString("base64url");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${header}.${claims}.${signature}` }),
  });
  if (!res.ok) throw new Error(`Google token exchange failed (${res.status})`);
  const json = (await res.json()) as { access_token: string; expires_in: number };
  tokenCache = { token: json.access_token, exp: now + json.expires_in };
  return json.access_token;
}
async function sheets(path: string, init?: RequestInit): Promise<any> {
  const token = await googleToken();
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}${path}`, {
    ...init, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...init?.headers },
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error?.message || `HTTP ${res.status}`);
  return json;
}
const rng = (tab: string, a1: string) => encodeURIComponent(`'${tab}'!${a1}`);
async function readAll(): Promise<Record<string, string[][]>> {
  const names = Object.keys(TABS);
  const q = names.map(t => `ranges=${rng(t, TABS[t as keyof typeof TABS].replace(/^A/, "A2"))}`).join("&");
  const out = await sheets(`/values:batchGet?${q}&majorDimension=ROWS`);
  const res: Record<string, string[][]> = {};
  names.forEach((t, i) => { res[t] = (out.valueRanges?.[i]?.values || []) as string[][]; });
  return res;
}
async function append(tab: string, row: (string | number)[]) {
  await sheets(`/values/${rng(tab, "A1")}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    { method: "POST", body: JSON.stringify({ values: [row.map(v => String(v ?? ""))] }) });
}
async function put(tab: string, a1: string, row: (string | number)[]) {
  await sheets(`/values/${rng(tab, a1)}?valueInputOption=RAW`, { method: "PUT", body: JSON.stringify({ values: [row.map(v => String(v ?? ""))] }) });
}
const t = (v: unknown, n = 400) => String(v ?? "").trim().slice(0, n);
const low = (v: unknown) => t(v, 120).toLowerCase();

function stateFor(all: Record<string, string[][]>, trainee: string) {
  const st: any = { status: {}, opened: {}, reps: [], signoffs: [], questions: [], notes: [] };
  for (const r of all.Progress) if (low(r[0]) === trainee) st.status[t(r[1])] = t(r[2]);
  for (const r of all.Opened) if (low(r[0]) === trainee) st.opened[t(r[1])] = t(r[2]);
  for (const r of all.Reps) if (low(r[0]) === trainee) st.reps.push({ skillId: t(r[1]), date: t(r[2]), note: t(r[3]), by: t(r[4]), at: t(r[5]) });
  for (const r of all.Signoffs) if (low(r[0]) === trainee) st.signoffs.push({ skillId: t(r[1]), decision: t(r[2]), note: t(r[3]), by: t(r[4]), at: t(r[5]) });
  for (const r of all.Questions) if (low(r[1]) === trainee) st.questions.push({ id: t(r[0]), skillId: t(r[2]), question: t(r[3]), askedAt: t(r[4]), by: t(r[5]), answer: t(r[6]), answeredBy: t(r[7]), answeredAt: t(r[8]) });
  for (const r of all.Notes) st.notes.push({ skillId: t(r[0]), note: t(r[1]), by: t(r[2]), at: t(r[3]) });
  return st;
}

function corsHeaders(origin: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": ALLOW.includes(origin) ? origin : ALLOW[0],
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "content-type, authorization",
    "Vary": "Origin",
  };
}

export default async (req: Request) => {
  const origin = req.headers.get("origin") || "";
  const base = corsHeaders(origin);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: base });
  const headers = { ...base, "content-type": "application/json" };
  const ok = (o: object) => new Response(JSON.stringify({ ok: true, ...o }), { headers });
  const fail = (status: number, error: string) => new Response(JSON.stringify({ ok: false, error }), { status, headers });

  try {
    const appKey = process.env.BLP_APP_ACCESS_KEY || "";
    const url = new URL(req.url);
    const body = req.method === "POST" ? ((await req.json().catch(() => ({}))) as Record<string, any>) : {};
    const idToken = t(body.idToken || url.searchParams.get("idToken") || (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, ""), 4000);
    const key = t(body.key || url.searchParams.get("key"), 100);
    const googleUser = idToken ? await verifyGoogle(idToken) : null;
    const keyOk = !!appKey && key === appKey;
    const authed = !!googleUser || keyOk;
    const isStaff = !!googleUser && STAFF.includes(googleUser);
    const fn = url.searchParams.get("fn") || "";

    if (req.method === "GET") {
      if (fn === "auth") return keyOk ? ok({}) : fail(401, "passcode not accepted");
      if (!authed) return fail(401, "sign in (or passcode) required");
      const all = await readAll();
      if (fn === "state") {
        const trainee = low(url.searchParams.get("trainee"));
        if (!trainee) return fail(400, "trainee required");
        if (googleUser && !isStaff && googleUser !== trainee) return fail(403, "you can only view your own progress");
        return ok({ state: stateFor(all, trainee) });
      }
      if (fn === "all") {
        if (!isStaff) return fail(403, "owners and trainers only");
        const states: Record<string, any> = {};
        const emails = new Set<string>(all.Trainees.map(r => low(r[0])).filter(Boolean));
        for (const r of all.Progress) emails.add(low(r[0]));
        for (const r of all.Reps) emails.add(low(r[0]));
        for (const e of emails) if (e) states[e] = stateFor(all, e);
        const trainees = all.Trainees.map(r => ({ email: low(r[0]), name: t(r[1]), start: t(r[2]), hoursPerWeek: Number(r[3] || 0) || undefined, active: low(r[4]) !== "no" }));
        return ok({ states, trainees });
      }
      return fail(400, "unknown fn");
    }

    if (req.method === "POST") {
      if (!authed) return fail(401, "sign in (or passcode) required");
      const action = t(body.action, 20);
      const trainee = low(body.trainee);
      const by = t(body.by, 60) || googleUser || "Team";
      const at = new Date().toISOString();
      const skillId = t(body.skillId, 20);
      const staffOnly = ["signoff", "answer", "note", "trainee"];
      if (staffOnly.includes(action) && !isStaff) return fail(403, "owners and Melissa only — sign in with Google");
      if (!staffOnly.includes(action) && googleUser && !isStaff && googleUser !== trainee) return fail(403, "you can only log your own progress");

      switch (action) {
        case "opened": {
          if (!trainee || !skillId) return fail(400, "trainee and skillId required");
          await append("Opened", [trainee, skillId, at]); return ok({});
        }
        case "status": {
          const status = low(body.status);
          if (!trainee || !skillId || !STATUSES.has(status)) return fail(400, "trainee, skillId and a valid status required");
          if ((status === "mastered" || status === "refresh") && !isStaff) return fail(403, "mastered/refresh come from sign-off");
          await upsertProgress(trainee, skillId, status, at, by); return ok({});
        }
        case "rep": {
          if (!trainee || !skillId) return fail(400, "trainee and skillId required");
          await append("Reps", [trainee, skillId, t(body.date, 10) || at.slice(0, 10), t(body.note), by, at]); return ok({});
        }
        case "signoff": {
          const decision = low(body.decision);
          if (!trainee || !skillId || !DECISIONS.has(decision)) return fail(400, "trainee, skillId and decision required");
          await append("Signoffs", [trainee, skillId, decision, t(body.note), googleUser || by, at]);
          await upsertProgress(trainee, skillId, decision === "mastered" ? "mastered" : decision === "refresh" ? "refresh" : "practiced", at, googleUser || by);
          return ok({});
        }
        case "question": {
          const q = t(body.question, 1000);
          if (!trainee || !skillId || !q) return fail(400, "trainee, skillId and question required");
          const id = "q" + Date.now();
          await append("Questions", [id, trainee, skillId, q, at, by, "", "", ""]); return ok({ id });
        }
        case "answer": {
          const id = t(body.id, 30), answer = t(body.answer, 2000);
          if (!id || !answer) return fail(400, "id and answer required");
          const cur = await sheets(`/values/${rng("Questions", "A2:A5000")}?majorDimension=ROWS`);
          const rows: string[][] = cur.values || [];
          const i = rows.findIndex(r => t(r[0]) === id);
          if (i < 0) return fail(404, "question not found");
          await put("Questions", `G${i + 2}:I${i + 2}`, [answer, googleUser || by, at]); return ok({});
        }
        case "note": {
          const note = t(body.note, 2000);
          if (!skillId || !note) return fail(400, "skillId and note required");
          await append("Notes", [skillId, note, googleUser || by, at]); return ok({});
        }
        case "trainee": {
          const email = low(body.email);
          if (!email) return fail(400, "email required");
          await append("Trainees", [email, t(body.name, 80), t(body.start, 10), t(body.hoursPerWeek, 5), body.active === false ? "no" : "yes"]); return ok({});
        }
      }
      return fail(400, "unknown action");
    }
    return fail(405, "method not allowed");
  } catch (e) {
    return fail(500, String((e as Error).message || e).slice(0, 300));
  }
};

async function upsertProgress(trainee: string, skillId: string, status: string, at: string, by: string) {
  const cur = await sheets(`/values/${rng("Progress", "A2:B10000")}?majorDimension=ROWS`);
  const rows: string[][] = cur.values || [];
  const i = rows.findIndex(r => low(r[0]) === trainee && t(r[1]) === skillId);
  if (i >= 0) await put("Progress", `C${i + 2}:E${i + 2}`, [status, at, by]);
  else await append("Progress", [trainee, skillId, status, at, by]);
}
