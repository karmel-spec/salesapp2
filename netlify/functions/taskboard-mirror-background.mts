/**
 * Store Map task board — BACKGROUND MIRROR (Brigham 9/11).
 *
 * taskboard-write used to forward each op to the Apps Script bridge inside
 * the request: the Lambda then waited for that 3–30 s call before the
 * response left, so "Add card" hung, the app's 20 s timeout fired and
 * cards looked like they vanished (Melissa 9/5–9/11). Netlify background
 * functions (`-background` suffix) return 202 at once and run for up to
 * 15 minutes, so the bridge mirror — sheet copy, activity log, owner
 * texts/emails — now happens here, off the user's clock.
 *
 * POST {key, ...op}   (same payload taskboard-write received, plus forceId)
 */
const BRIDGE_URL =
  "https://script.google.com/macros/s/AKfycbxY4BKnr_Tr0iCTc9itCWhNYLvgszmkI1IoYSkbBWpyAqRtWI-yaUkJQjcVdgG58KXt/exec";

export default async (req: Request) => {
  let p: Record<string, unknown>;
  try { p = await req.json(); } catch { return new Response("bad json", { status: 400 }); }
  const key = process.env.BLP_APP_ACCESS_KEY || "";
  if (p.key !== key && p.pin !== key) return new Response("bad key", { status: 401 });
  const body = JSON.stringify({ ...p, action: "taskcard" });
  // the bridge answers HTML or its generic ping for a few minutes after a
  // deploy — retry through it so the sheet mirror and notifications land
  for (let a = 0; a < 4; a++) {
    try {
      const r = await fetch(BRIDGE_URL, {
        method: "POST",
        headers: { "content-type": "text/plain;charset=utf-8" },
        body,
        redirect: "follow",
        signal: AbortSignal.timeout(45000),
      });
      const txt = await r.text();
      let j: { ok?: boolean; error?: string; service?: string } | null = null;
      try { j = JSON.parse(txt); } catch { j = null; }
      if (j && (j.ok || j.error) && !j.service) {
        if (j.error) console.warn("taskboard-mirror: bridge rejected", String(p.op), j.error);
        return new Response("", { status: 202 });
      }
    } catch (e) {
      console.warn("taskboard-mirror attempt", a + 1, String((e as Error).message || e));
    }
    await new Promise((res) => setTimeout(res, 3000 * (a + 1)));
  }
  console.error("taskboard-mirror: gave up", String(p.op), String(p.id || p.forceId || ""));
  return new Response("", { status: 202 });
};
