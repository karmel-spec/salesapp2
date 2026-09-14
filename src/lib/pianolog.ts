import { getGoogleToken } from "./sheets";
import type { LeadWatch } from "./leads";

/**
 * Read-only view of the Piano Log & Inventory sheet (the shop's inventory
 * source of truth) for watch snoozes. Same service account as the Leads Log;
 * the sheet is shared with it read-only. Cached 5 minutes.
 */
const SHEET_ID = process.env.PIANO_LOG_SHEET_ID || "1ZunbPKygpQlcXfTyPowDHdUE9spJ3uV1XA4iX1eoKRc";
const TAB = process.env.PIANO_LOG_TAB || "Piano Log";
const CACHE_MS = 5 * 60_000;

export interface Piano {
  row: number;
  serial: string;
  year: string;
  make: string;
  model: string;
  size: string;
  category: string;
  summary: string;
  status: string; // S: "Used, For Sale, Refurbished" …
  location: string; // U
  phase: string; // DO: CURRENT PHASE
  price: string; // BJ
  completion: string; // AB
  section: string; // nearest ALL-CAPS section row above ("USED SHOWROOM", "CUSTOM SHOPWORK" …)
  sold: boolean;
  forSale: boolean;
  finished: boolean;
  /** Could be offered to a customer: not sold, and not a customer's own shop job,
   *  discarded, museum, rented, deep storage, or a consignment on hold. */
  sellable: boolean;
  haystack: string;
}
const NOT_SELLABLE = /discard|museum|rented|storage|on hold|decommission|custom shop|pending shop|follow ?up|\(web\)/i;

let cache: { at: number; pianos: Piano[] } | null = null;

export async function getPianos(force = false): Promise<Piano[]> {
  if (!force && cache && Date.now() - cache.at < CACHE_MS) return cache.pianos;
  const tok = await getGoogleToken();
  const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(`${TAB}!A1:DO5000`)}`, { headers: { authorization: `Bearer ${tok}` } });
  const j = (await r.json()) as { values?: string[][]; error?: { message: string } };
  if (j.error) throw new Error(`Piano Log read failed: ${j.error.message}`);
  const rows = j.values || [];
  const pianos: Piano[] = [];
  let section = "";
  for (let i = 5; i < rows.length; i++) {
    const row = rows[i];
    const owner = (row[1] || "").trim();
    const serial = (row[2] || "").trim();
    const make = (row[5] || "").trim();
    if (owner && owner === owner.toUpperCase() && /[A-Z]/.test(owner) && !serial && !make) { section = owner; continue; }
    if (!serial && !make && !(row[3] || "").trim()) continue;
    const status = (row[18] || "").trim();
    const phase = (row[118] || "").trim();
    const completion = (row[27] || "").trim();
    const sold = /\bsold\b/i.test(status) || /^sold$/i.test(phase) || /\bsold\b/i.test(section);
    const forSale = !sold && (/for sale/i.test(status) || /^for sale$/i.test(phase) || /showroom/i.test(section));
    const finished = !sold && (forSale || /^(for sale|delivered|exit prep - admin)$/i.test(phase) || (!!completion && !/^12\/31\/1899/.test(completion)));
    const p: Piano = {
      row: i + 1, serial, year: (row[4] || "").trim(), make, model: (row[6] || "").trim(), size: (row[7] || "").trim(), category: (row[9] || "").trim(),
      summary: (row[3] || "").trim(), status, location: (row[20] || "").trim(), phase, price: (row[61] || "").trim(), completion, section, sold, forSale, finished, sellable: !sold && !NOT_SELLABLE.test(section), haystack: "",
    };
    p.haystack = [p.year, p.make, p.model, p.size, p.category, p.summary, p.section].join(" | ").toLowerCase();
    pianos.push(p);
  }
  cache = { at: Date.now(), pianos };
  return pianos;
}

const STOP = new Set(["a", "an", "the", "piano", "pianos", "any", "another", "one", "in", "for", "when", "get", "you", "we", "call", "me", "like", "early", "late", "please", "want", "wants", "would", "of", "to", "and", "with", "used", "new"]);
const SYN: Record<string, string[]> = {
  spinet: ["spinet"], console: ["console"], studio: ["studio"], upright: ["upright"], grand: ["grand"], baby: ["baby"],
  acrosonic: ["acrosonic"], "m&h": ["mason"], "mason&hamlin": ["mason"], "mason": ["mason"], hamlin: ["hamlin"],
  steinway: ["steinway"], yamaha: ["yamaha"], kawai: ["kawai"], baldwin: ["baldwin"], kimball: ["kimball"], wurlitzer: ["wurlitzer"], haddorff: ["haddorff", "haddorf"], haddorf: ["haddorff", "haddorf"],
  player: ["player", "qrs", "pianodisc"], digital: ["digital"], hailun: ["hailun"],
};

/** "acrosonic spinet, wurlitzer spinet or early kimball" → [["acrosonic","spinet"],["wurlitzer","spinet"],["kimball"]] plus decade filters. */
export function parseWatchText(text: string): { alts: { tokens: string[]; decades: string[] }[] } {
  const alts = text
    .toLowerCase()
    .replace(/#\S+/g, " ")
    .split(/,|;|\bor\b|\//)
    .map((part) => {
      const decades: string[] = [];
      const tokens: string[] = [];
      for (const w of part.replace(/[^a-z0-9&'\s-]/g, " ").split(/\s+/)) {
        if (!w) continue;
        const dec = /^(1[89]\d)0'?s?$/.exec(w) || /^(1[89]\d)0s?-(1[89]\d)0s?$/.exec(w);
        if (dec) { if (dec[2]) { for (let d = Number(dec[1]); d <= Number(dec[2]); d++) decades.push(String(d)); } else decades.push(dec[1]); continue; }
        const clean = w.replace(/'s$/, "").replace(/-/g, "");
        if (clean.length < 3 || STOP.has(clean)) continue;
        tokens.push(clean);
      }
      return { tokens, decades };
    })
    .filter((a) => a.tokens.length || a.decades.length);
  return { alts };
}

function tokenHits(token: string, hay: string): boolean {
  const alts = SYN[token] || [token];
  return alts.some((t) => hay.includes(t));
}

/** Pianos matching the watch text (any alternative; all its tokens must hit). Not-sold only. */
export function matchArrival(watch: LeadWatch, pianos: Piano[]): Piano[] {
  const { alts } = parseWatchText(watch.text);
  if (!alts.length) return [];
  return pianos.filter((p) => p.sellable && alts.some((a) => a.tokens.every((t) => tokenHits(t, p.haystack)) && (!a.decades.length || a.decades.some((d) => p.year.startsWith(d)))));
}

export function findBySerial(serial: string, pianos: Piano[]): Piano | undefined {
  const norm = (s: string) => s.replace(/[^a-z0-9]/gi, "").toLowerCase();
  const n = norm(serial);
  return n ? pianos.find((p) => norm(p.serial) === n) : undefined;
}

export function describe(p: Piano): string {
  const bits = [p.year, p.make, p.model, p.size].filter(Boolean).join(" ");
  const where = [p.section, p.location].filter(Boolean).join(" · ");
  const stage = p.forSale ? "For Sale" : p.phase ? `in the shop · ${p.phase}` : p.status || "in the log";
  return `${bits || p.summary || "piano"}${p.serial ? ` #${p.serial}` : ""}${p.price ? ` · ${p.price}` : ""} — ${stage}${where ? ` (${where})` : ""} · Piano Log row ${p.row}`;
}
