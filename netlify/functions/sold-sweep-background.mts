/** Below SOLD means Delivered — the bridge sweep, run in the background (15 min, no retry). */
export default async () => {
  const B = "https://script.google.com/macros/s/AKfycbxY4BKnr_Tr0iCTc9itCWhNYLvgszmkI1IoYSkbBWpyAqRtWI-yaUkJQjcVdgG58KXt/exec";
  try {
    const r = await fetch(B, { method: "POST", redirect: "follow", signal: AbortSignal.timeout(90000),
      headers: { "content-type": "text/plain" }, body: JSON.stringify({ pin: "pianoman", key: "pianoman", action: "soldsweep" }) });
    const j = await r.json().catch(() => null) as { changed?: unknown[]; skipped?: string; error?: string } | null;
    if (j && j.changed && j.changed.length) console.log("sold-sweep: set Delivered on", JSON.stringify(j.changed));
    if (j && (j.error || j.skipped)) console.log("sold-sweep:", j.error || j.skipped);
  } catch (e) { console.error("sold-sweep-background:", String(e)); }
};
