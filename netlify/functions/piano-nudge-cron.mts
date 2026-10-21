/** ⏰ Piano clock reminder (Mark 10/21, app request 102126hales57): every 15
 *  minutes in shop hours, ask the bridge who clocked in for the day an hour
 *  ago but isn't on the Work Clock yet. The bridge texts them once — only
 *  while App Settings `piano_nudge` = on; otherwise each run is a preview. */
export const config = { schedule: "*/15 12-23 * * 1-6" };   // UTC: ~6 AM–5:45 PM Denver, Mon–Sat
const BRIDGE_URL = process.env.BLP_BRIDGE_URL || "https://script.google.com/macros/s/AKfycbxY4BKnr_Tr0iCTc9itCWhNYLvgszmkI1IoYSkbBWpyAqRtWI-yaUkJQjcVdgG58KXt/exec";

export default async () => {
  try {
    const r = await fetch(`${BRIDGE_URL}?fn=pianonudge&key=pianoman`, { redirect: "follow", signal: AbortSignal.timeout(25000) });
    const j = (await r.json().catch(() => ({}))) as { dry?: boolean; texted?: { tech: string }[]; wouldText?: { tech: string }[]; error?: string };
    console.log(`[piano-nudge] ${j.error ? "error " + j.error : (j.dry ? "preview" : "live")} texted ${(j.texted || []).map((x) => x.tech).join(", ") || "-"} would ${(j.wouldText || []).map((x) => x.tech).join(", ") || "-"}`);
    return new Response(JSON.stringify(j), { status: 200, headers: { "content-type": "application/json" } });
  } catch (e) {
    console.error("[piano-nudge] failed:", e);
    return new Response(String(e), { status: 500 });
  }
};
