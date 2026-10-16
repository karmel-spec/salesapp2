/** Hand a scheduled job to a background function (Walter 10/16): Netlify kills a
 * scheduled function that runs past its limit and RETRIES it, so a slow bridge
 * turned 10–25 s jobs into stacked duplicates (soldsweep ×3, contractsync ×2,
 * standup text ×2). A background function gets 15 min and no retry. */
export async function kick(req: Request | undefined, fn: string, payload: unknown = {}): Promise<string> {
  const base = (() => { try { return req ? new URL(req.url).origin : ""; } catch { return ""; } })() || "https://blpsalesapp.netlify.app";
  try {
    const r = await fetch(`${base}/.netlify/functions/${fn}`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(payload), signal: AbortSignal.timeout(5000) });
    return `${fn}: ${r.status}`;
  } catch (e) { return `${fn}: ${String(e).slice(0, 80)}`; }
}
