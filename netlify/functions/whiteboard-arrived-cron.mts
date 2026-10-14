/**
 * Whiteboard "it's here" text (Walter 10/14): once a request has been marked
 * Arrived for 15 minutes, text the person who added it — the wait is so an
 * accidental Arrived tap, undone right away, never texts anyone. Runs every
 * 5 min, so the text lands 15–20 min after the tap.
 *
 * Whiteboard tab: D = Added by, F = Arrived, J = Removed, K = exact Arrived
 * time (whiteboard.mts writes it; un-marking clears it), L = texted stamp.
 * Only rows with a K time get a text, so items marked Arrived before this
 * existed stay quiet. Several items for one person arriving together go out
 * as one text. Skipped (and stamped in L, so never retried): the person who
 * marked it Arrived is the one who asked for it, a non-person "Added by"
 * (Whiteboard (photo), Team, test rows), or no number on Tech Phones.
 * request-notify applies quiet hours (held until 10 AM).
 */
import { REPORT_SHEET, KEY, SITE, googleToken, sheetGet } from "./_blp-sched-lib.mts";

const TAB = "Whiteboard";
const WAIT_MS = 15 * 60000;
const STALE_MS = 3 * 86400000;   // a K time older than this (cron was down) is not texted

async function stampL(updates: { row: number; v: string }[]) {
  if (!updates.length) return;
  const t = await googleToken();
  await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${REPORT_SHEET}/values:batchUpdate`, {
    method: "POST", headers: { Authorization: "Bearer " + t, "Content-Type": "application/json" },
    body: JSON.stringify({ valueInputOption: "RAW",
      data: updates.map(u => ({ range: `'${TAB}'!L${u.row}`, values: [[u.v]] })) }),
  });
}

export default async () => {
  try {
    const rows = await sheetGet(REPORT_SHEET, `'${TAB}'!A2:L2000`);
    const now = Date.now();
    const due = new Map<string, { name: string; items: { row: number; text: string }[] }>();
    const skip: { row: number; v: string }[] = [];
    const stampNow = new Date().toLocaleString("en-US", { timeZone: "America/Denver",
      month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" });
    rows.forEach((r, i) => {
      const row = i + 2;
      const g = (j: number) => String(r[j] ?? "").trim();
      if (g(5) !== "TRUE" || g(9) || g(11)) return;           // not arrived / removed / already handled
      const at = Date.parse(g(10));
      if (!at || now - at < WAIT_MS) return;                  // no exact time, or still inside 15 min
      if (now - at > STALE_MS) { skip.push({ row, v: "skipped " + stampNow + " · too old" }); return; }
      const name = g(3);
      const markedBy = (g(6).split("·")[1] || "").trim();
      if (!name || /whiteboard|photo|^team$|test/i.test(name)) { skip.push({ row, v: "skipped " + stampNow + " · no person" }); return; }
      if (markedBy && markedBy.split(/\s+/)[0].toLowerCase() === name.split(/\s+/)[0].toLowerCase()) {
        skip.push({ row, v: "skipped " + stampNow + " · they marked it themselves" }); return;
      }
      const note = g(2);
      const text = g(1) + (note ? ` (${note})` : "");
      const k = name.toLowerCase();
      if (!due.has(k)) due.set(k, { name, items: [] });
      due.get(k)!.items.push({ row, text });
    });
    await stampL(skip);
    for (const { name, items } of due.values()) {
      // claim the rows first: a send that fails after this is reported in L,
      // never repeated every 5 minutes
      await stampL(items.map(it => ({ row: it.row, v: "sending " + stampNow })));
      const first = name.split(/\s+/)[0];
      const msg = items.length === 1
        ? `📬 ${first}, your whiteboard request has arrived: ${items[0].text}`
        : `📬 ${first}, your whiteboard requests have arrived:\n` + items.map(it => "• " + it.text).join("\n");
      let res = "";
      try {
        const r = await fetch(SITE + "/.netlify/functions/request-notify", { method: "POST",
          headers: { "content-type": "application/json" }, body: JSON.stringify({ key: KEY(), name, message: msg }) });
        const j = await r.json() as { sent?: boolean; queued?: boolean; reason?: string; error?: string };
        res = j.sent ? "texted" : j.queued ? "texted (held for quiet hours)" : "not texted · " + (j.reason || j.error || "unknown");
      } catch (e) { res = "not texted · " + String(e).slice(0, 80); }
      await stampL(items.map(it => ({ row: it.row, v: res + " " + stampNow })));
    }
  } catch (e) {
    console.error("whiteboard-arrived-cron:", String(e));
  }
};

export const config = { schedule: "*/5 * * * *" };
