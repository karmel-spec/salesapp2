/**
 * Every 10 minutes: run the sheet → Supabase task-board reconciler, so
 * any write that fell back to the Apps Script bridge (stale cached app,
 * proxy blip) becomes visible on the boards within minutes.
 */
export default async () => {
  const key = process.env.BLP_APP_ACCESS_KEY || "";
  try {
    const r = await fetch(
      "https://blpsalesapp.netlify.app/.netlify/functions/taskboard-reconcile?key=" + encodeURIComponent(key),
    );
    const j = await r.json().catch(() => ({}));
    if ((j as { addedCards?: number }).addedCards) {
      console.log("taskboard-reconcile:", JSON.stringify(j));
    }
  } catch (e) {
    console.error("taskboard-reconcile-cron failed:", String(e));
  }
};

export const config = { schedule: "*/10 * * * *" };
