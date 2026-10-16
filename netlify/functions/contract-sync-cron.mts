/**
 * 📜→🧾 Contract sync (Brigham 9/4): every 10 minutes, ask the bridge to
 * apply any NEW Shopwork Agreement form responses (Restoration Contracts
 * tab) to the matching pianos' Scope of Work. The bridge stamps each row,
 * so this is idempotent; rows for pianos not yet in the log retry
 * automatically until the piano arrives.
 */
const BRIDGE_URL =
  "https://script.google.com/macros/s/AKfycbxY4BKnr_Tr0iCTc9itCWhNYLvgszmkI1IoYSkbBWpyAqRtWI-yaUkJQjcVdgG58KXt/exec";

export default async () => {
  // one attempt with a timeout, every 30 min (Walter 10/16): the old 3-try loop
  // re-ran a 25 s bridge job whenever the bridge answered slowly, stacking
  // runs during the 8 AM congestion. The bridge stamps synced rows, so a
  // missed run is simply picked up by the next one.
  try {
    const r = await fetch(BRIDGE_URL, {
      method: "POST", redirect: "follow", signal: AbortSignal.timeout(20000),
      headers: { "content-type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ pin: "pianoman", action: "contractsync" }),
    });
    const t = await r.text();
    let j: any = null;
    try { j = JSON.parse(t); } catch { /* html page */ }
    if (j && j.ok) return new Response(JSON.stringify({ synced: (j.synced || []).length, alreadyDone: j.alreadyDone, skipped: j.skipped || "" }));
    return new Response(JSON.stringify(j || { error: "non-JSON answer" }), { status: 502 });
  } catch (e) {
    return new Response("bridge unreachable: " + String(e).slice(0, 120), { status: 502 });
  }
};
export const config = { schedule: "*/30 * * * *" };
