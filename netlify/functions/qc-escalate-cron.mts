/**
 * Every 10 minutes: any mini-QC request pending >30 min without a manager
 * verdict escalates by text to Mark AND Karmel (once).
 */
export default async () => {
  const key = process.env.BLP_APP_ACCESS_KEY || "";
  const SB = process.env.SUPABASE_URL || "";
  const sk = process.env.SUPABASE_SERVICE_KEY || "";
  if (!SB || !sk) return;
  const h = { apikey: sk, Authorization: "Bearer " + sk, "Content-Type": "application/json" };
  let escMin = 30;
  try {
    const { loadSettings } = await import("./app-settings.mts");
    const st = (await loadSettings()).settings;
    if (st.qc_escalate_minutes) escMin = Number(st.qc_escalate_minutes) || 30;
  } catch { /* default */ }
  const cutoff = new Date(Date.now() - escMin * 60000).toISOString();
  const rows = (await (await fetch(
    `${SB}/rest/v1/qc_requests?status=eq.pending&escalated=eq.false&created=lt.${encodeURIComponent(cutoff)}`,
    { headers: h })).json()) as Array<{ id: number; serial: string; piano: string; phase: string; requested_by: string }>;
  for (const q of rows) {
    const msg = `⏰ Mini-QC waiting ${">"}${escMin} min — ${q.phase} on ${q.piano || "#" + q.serial} (requested by ${String(q.requested_by || "").split(" ")[0]}). Inspect: https://blpstoremap.netlify.app/#qc=${q.id}`;
    // during the training month (through 10/3) Brigham owns every mini-QC —
    // silence nudges him again and loops in Mark; afterwards Mark + Karmel
    let escalateTo = ["Brigham", "Mark Hales"];
    try {
      const { loadSettings } = await import("./app-settings.mts");
      const st = (await loadSettings()).settings;
      if (st.qc_escalate_to) escalateTo = st.qc_escalate_to.split(",").map((x: string) => x.trim()).filter(Boolean);
    } catch { /* defaults */ }
    for (const name of escalateTo) {
      await fetch("https://blpsalesapp.netlify.app/.netlify/functions/request-notify", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ key, name, message: msg }),
      }).catch(() => {});
    }
    await fetch(`${SB}/rest/v1/qc_requests?id=eq.${q.id}`, {
      method: "PATCH", headers: h,
      body: JSON.stringify({ escalated: true, updated: new Date().toISOString() }),
    }).catch(() => {});
  }
};
export const config = { schedule: "*/10 * * * *" };
