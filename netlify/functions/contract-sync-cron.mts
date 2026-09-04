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
  for (let a = 0; a < 3; a++) {
    try {
      const r = await fetch(BRIDGE_URL, {
        method: "POST", redirect: "follow",
        headers: { "content-type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ pin: "pianoman", action: "contractsync" }),
      });
      const t = await r.text();
      let j: any = null;
      try { j = JSON.parse(t); } catch { /* html page — retry */ }
      if (j && j.ok) return new Response(JSON.stringify({ synced: (j.synced || []).length, alreadyDone: j.alreadyDone }));
      if (j && j.error) return new Response(JSON.stringify(j), { status: 502 });
    } catch { /* retry */ }
    await new Promise(res => setTimeout(res, 4000));
  }
  return new Response("bridge unreachable", { status: 502 });
};
export const config = { schedule: "*/10 * * * *" };
