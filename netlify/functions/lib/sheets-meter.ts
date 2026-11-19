/**
 * TEMPORARY Google Sheets call meter (Brigham 11/18/2026).
 *
 * Every BLP app on this Google service account shares one quota: 60 reads per
 * minute. To find out what uses it, each call to sheets.googleapis.com from
 * this site is logged as one row in Supabase `public.sheets_meter`: which
 * function, read or write, which spreadsheet and tab. No cell values, no
 * tokens, no URLs with data.
 *
 * Install once per bundle: installSheetsMeter("<function name>"). It patches
 * global fetch for Sheets URLs only and turns itself off at METER_UNTIL, so
 * it cannot run forever if nobody removes it. Logging never blocks or breaks
 * the real call: the insert runs alongside the Sheets request and is capped
 * at 1.5 s.
 *
 * Counting: rows with status IS NULL are calls; rows with status 429 are
 * extra markers for calls Google rate-limited.
 */
const METER_UNTIL = Date.parse("2026-11-21T07:00:00Z"); // Fri 11/21 00:00 Mountain
const FLAG = Symbol.for("blp.sheetsMeter");
const SHEET_LABELS: Record<string, string> = {
  "1sdOeaChihEjAQBCi8U0_lTTlYP4H38eiC6zgmRLoWC0": "Leads Log",
  "1ZunbPKygpQlcXfTyPowDHdUE9spJ3uV1XA4iX1eoKRc": "Piano Log",
};

type Info = { kind: "read" | "write"; sheet: string; target: string };

function tabOf(range: string): string {
  const r = decodeURIComponent(range);
  const tab = r.includes("!") ? r.slice(0, r.lastIndexOf("!")) : r;
  return tab.replace(/^'|'$/g, "");
}

function describe(url: string, method: string): Info {
  const u = new URL(url);
  const m = u.pathname.match(/\/v4\/spreadsheets\/([^/:]+)(.*)$/);
  const id = m?.[1] || "?";
  const rest = m?.[2] || "";
  const sheet = SHEET_LABELS[id] || id.slice(0, 8);
  let target: string;
  let kind: Info["kind"] = method === "GET" ? "read" : "write";
  if (rest.startsWith("/values:batchGet")) {
    kind = "read";
    target = "batchGet: " + [...new Set(u.searchParams.getAll("ranges").map(tabOf))].join(", ");
  } else if (rest.startsWith("/values:batchUpdate")) {
    target = "values:batchUpdate";
  } else if (rest.startsWith("/values/")) {
    const seg = rest.slice("/values/".length);
    const colon = seg.indexOf(":");
    const op = colon >= 0 ? seg.slice(colon + 1) : "";
    const range = colon >= 0 ? seg.slice(0, colon) : seg;
    target = tabOf(range) + (op ? ` (${op})` : "");
  } else if (rest.startsWith(":batchUpdate")) {
    target = "batchUpdate";
  } else {
    kind = "read";
    target = "metadata";
  }
  return { kind, sheet, target: target.slice(0, 160) };
}

export function installSheetsMeter(fn: string, site = "blpsalesapp"): void {
  const g = globalThis as unknown as Record<symbol, unknown>;
  if (g[FLAG]) return;
  g[FLAG] = fn;
  if (Date.now() > METER_UNTIL) return;
  // Live Netlify functions run on AWS Lambda; anything else is a dev machine.
  if (!process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NETLIFY_DEV === "true") site = "local";
  const sbUrl = process.env.SUPABASE_URL || "";
  const sbKey = process.env.SUPABASE_SERVICE_KEY || "";
  if (!sbUrl || !sbKey) return;
  const orig = globalThis.fetch.bind(globalThis);

  const record = (info: Info, status: number | null, route: string | null): Promise<void> =>
    orig(`${sbUrl}/rest/v1/sheets_meter`, {
      method: "POST",
      headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}`, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ site, fn, kind: info.kind, sheet: info.sheet, target: info.target, status, route }),
    }).then(() => undefined, () => undefined);
  // Next.js route that made the call, from the async stack
  // (".next/server/app/api/track/[token]/route.js" → "api/track/[token]").
  const routeOf = (stack: string | undefined): string | null => {
    const m = (stack || "").match(/server\/app\/(.+?)\/(route|page)\.js/);
    return m ? m[1].slice(0, 120) : null;
  };
  const settle = (p: Promise<void>) =>
    Promise.race([p, new Promise<void>((r) => setTimeout(r, 1500))]);

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith("https://sheets.googleapis.com/") || Date.now() > METER_UNTIL) return orig(input, init);
    let info: Info | null = null;
    let route: string | null = null;
    try {
      const method = String(init?.method || (typeof input === "object" && "method" in input ? input.method : "GET")).toUpperCase();
      info = describe(url, method);
      route = routeOf(new Error().stack);
    } catch { /* never block the real call */ }
    const logged = info ? record(info, null, route) : Promise.resolve();
    const res = await orig(input, init);
    const extra = info && res.status === 429 ? record(info, 429, route) : Promise.resolve();
    await settle(Promise.all([logged, extra]).then(() => undefined));
    return res;
  }) as typeof fetch;
}
