/** 📜→🧾 Contract sync — the bridge job, run in the background (15 min, no retry). */
export default async () => {
  const B = "https://script.google.com/macros/s/AKfycbxY4BKnr_Tr0iCTc9itCWhNYLvgszmkI1IoYSkbBWpyAqRtWI-yaUkJQjcVdgG58KXt/exec";
  try {
    const r = await fetch(B, { method: "POST", redirect: "follow", signal: AbortSignal.timeout(90000),
      headers: { "content-type": "text/plain;charset=utf-8" }, body: JSON.stringify({ pin: "pianoman", action: "contractsync" }) });
    const j = await r.json().catch(() => null) as { synced?: unknown[]; skipped?: string; error?: string } | null;
    console.log("contract-sync:", j ? JSON.stringify({ synced: (j.synced || []).length, skipped: j.skipped, error: j.error }) : "non-JSON answer");
  } catch (e) { console.error("contract-sync-background:", String(e)); }
};
