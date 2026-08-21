/**
 * Preflight for the 7:50 AM standup text — confirms every dependency is in
 * place (env vars present, bridge reachable and authorized, all five numbers
 * resolving) without texting anyone.
 *
 *   POST {key} → {ready, verdict, env, bridge, roster, today}
 *
 * Key-gated with BLP_APP_ACCESS_KEY, the same convention request-notify uses.
 * Secrets are reported as present/absent only — never echoed.
 */
import { checkStandupText } from "./lib/standup-text";

const APP_KEY = process.env.BLP_APP_ACCESS_KEY || "pianoman";
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o, null, 1), {
    status, headers: { "content-type": "application/json" },
  });

export default async (req: Request) => {
  let key = "";
  try {
    if (req.method === "POST") {
      key = ((await req.json()) as { key?: string }).key || "";
    } else {
      key = new URL(req.url).searchParams.get("key") || "";
    }
  } catch { /* fall through to the gate */ }
  if (key !== APP_KEY) return json({ error: "unauthorized" }, 403);
  try {
    return json(await checkStandupText());
  } catch (e) {
    return json({ ready: false, error: (e as Error).message }, 500);
  }
};
