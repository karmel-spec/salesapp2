/**
 * ONE-TIME (Mark 11/19): Sadie is a technician now, not an intern. On the
 * scheduling rules sheet's "Tech Specialties" tab her row sits under the
 * "interns" heading; this moves it to the end of the "team members" block.
 * GET ?key=…            → dry run: what it found and what it would do
 * GET ?key=…&go=1       → does it (one atomic batchUpdate)
 * Delete this function after the run.
 */
import { googleToken, KEY } from "./_blp-sched-lib.mts";

const SEQ_ID = "1k9ToAeueEg5WOtaY91xXzL-a0l_AJsSZWw23tcAWECU";
const TAB = "Tech Specialties";
const NAME = "Sadie";

export default async (req: Request) => {
  const u = new URL(req.url);
  const json = (o: unknown, status = 200) => new Response(JSON.stringify(o, null, 1), { status, headers: { "content-type": "application/json" } });
  if ((u.searchParams.get("key") || "") !== KEY()) return json({ error: "unauthorized" }, 401);
  const go = u.searchParams.get("go") === "1";
  const token = await googleToken();
  const api = async (path: string, init?: RequestInit) => {
    const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SEQ_ID}${path}`, {
      ...init, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } });
    const j = await r.json();
    if (!r.ok) throw new Error(j?.error?.message || `HTTP ${r.status}`);
    return j;
  };
  try {
    const meta = await api(`?fields=sheets(properties(sheetId,title))`);
    const sh = (meta.sheets || []).find((s: any) => s.properties.title === TAB);
    if (!sh) return json({ error: "tab not found" }, 404);
    const sheetId = sh.properties.sheetId;
    const got = await api(`/values/${encodeURIComponent(`'${TAB}'!A1:AA60`)}?valueRenderOption=FORMULA`);
    const rows: string[][] = got.values || [];
    const a = (i: number) => String((rows[i] || [])[0] || "").trim();
    const low = (i: number) => a(i).toLowerCase();
    const iTeam = rows.findIndex((_, i) => low(i) === "team members");
    const iSub = rows.findIndex((_, i) => low(i) === "subcontractors");
    const iInt = rows.findIndex((_, i) => low(i) === "interns");
    const iName = rows.findIndex((_, i) => a(i) === NAME);
    if (iTeam < 0 || iSub < 0 || iInt < 0) return json({ error: "section headings not found", iTeam, iSub, iInt });
    if (iName < 0) return json({ error: `${NAME} not found` });
    if (iName > iTeam && iName < iSub) return json({ ok: true, already: true, note: `${NAME} is already under team members (row ${iName + 1})` });
    if (!(iName > iInt)) return json({ error: `${NAME} is not under interns`, row: iName + 1 });
    // last filled team-member row
    let iLast = iTeam;
    for (let i = iTeam + 1; i < iSub; i++) if (a(i)) iLast = i;
    const nameRow = rows[iName] || [];
    const plan = {
      tab: TAB,
      found: { teamMembersRow: iTeam + 1, lastTeamMemberRow: iLast + 1, lastTeamMember: a(iLast), subcontractorsRow: iSub + 1, internsRow: iInt + 1, nameRow: iName + 1, nameRowValues: nameRow },
      lastTeamRowFormulas: (rows[iLast] || []).filter((v) => String(v).startsWith("=")),
      will: [`insert a blank row after row ${iLast + 1} (same formatting)`, `write "${NAME}" plus her existing cells into the new row ${iLast + 2}`, `delete her old row (row ${iName + 2} after the insert)`],
    };
    if (!go) return json({ ok: true, dryRun: true, ...plan });
    const values = [NAME, ...nameRow.slice(1)].map((v) => {
      const s = String(v ?? "");
      return s === "" ? { userEnteredValue: {} } : s.startsWith("=") ? { userEnteredValue: { formulaValue: s } }
        : /^-?\d+(\.\d+)?$/.test(s) ? { userEnteredValue: { numberValue: Number(s) } } : { userEnteredValue: { stringValue: s } };
    });
    const out = await api(`:batchUpdate`, { method: "POST", body: JSON.stringify({ requests: [
      { insertDimension: { range: { sheetId, dimension: "ROWS", startIndex: iLast + 1, endIndex: iLast + 2 }, inheritFromBefore: true } },
      { updateCells: { start: { sheetId, rowIndex: iLast + 1, columnIndex: 0 }, rows: [{ values }], fields: "userEnteredValue" } },
      { deleteDimension: { range: { sheetId, dimension: "ROWS", startIndex: iName + 1, endIndex: iName + 2 } } },
    ] }) });
    const after = await api(`/values/${encodeURIComponent(`'${TAB}'!A1:A60`)}`);
    return json({ ok: true, done: true, replies: (out.replies || []).length, columnA: (after.values || []).map((r: string[], i: number) => `${i + 1}: ${r[0] || ""}`) });
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
};
