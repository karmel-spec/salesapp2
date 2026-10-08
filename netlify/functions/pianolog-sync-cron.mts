/**
 * Every 3 minutes: refresh the Piano Log read mirror in Supabase so a sheet
 * edit by staff shows in the Store Map and the Piano Log app within ~3 min
 * even when no app write and no sheet trigger kicked a sync.
 */
export default async () => {
  const key = process.env.BLP_APP_ACCESS_KEY || "";
  try {
    const r = await fetch(
      "https://blpsalesapp.netlify.app/.netlify/functions/pianolog-sync-background?key=" + encodeURIComponent(key) + "&source=cron",
      { method: "POST" },
    );
    if (r.status !== 202 && r.status !== 200) console.warn("pianolog-sync-cron: sync returned", r.status);
  } catch (e) {
    console.error("pianolog-sync-cron failed:", String(e));
  }
};

export const config = { schedule: "*/3 * * * *" };
