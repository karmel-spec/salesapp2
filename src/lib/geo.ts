import placesRaw from "./data/us-places.json";
import zipsRaw from "./data/us-zips.json";
import { NAME_TO_ABBR, STATE_CENTROIDS, STATE_NAMES, LeadGeo } from "./geo-shared";

/**
 * Location extraction for the Lead Map. The Leads Log has no location column —
 * places live in free text ("1913 player piano in Palm Beach, FL", an address
 * in the notes, "moving to Montana"). We pull the best mention out and geocode
 * it against bundled US Census Gazetteer data (public domain), so there's no
 * external geocoding API, no key, and no per-lead latency.
 *
 * Precision ladder: "City, ST" beats "ST 84003" (zip) beats a bare state name.
 * Earlier text sources (headline before notes) win ties.
 */

const PLACES = placesRaw as unknown as Record<string, [number, number]>;
const ZIPS = zipsRaw as unknown as Record<string, [number, number]>;

/** Normalize a city name the same way for the table and the probe. */
function normCity(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[.'’]/g, "")
    .replace(/^saint\s+/, "st ")
    .replace(/^ft\.?\s+/, "fort ")
    .replace(/\s+/g, " ")
    .trim();
}

// Re-key the gazetteer once at module load with normalized names, and track
// which states each city name appears in (for the unique-name fallback).
const PLACE_INDEX = new Map<string, [number, number]>();
const CITY_STATES = new Map<string, string[]>();
for (const [key, coords] of Object.entries(PLACES)) {
  const [city, st] = key.split("|");
  const norm = normCity(city);
  PLACE_INDEX.set(`${norm}|${st}`, coords);
  const states = CITY_STATES.get(norm);
  if (states) {
    if (!states.includes(st)) states.push(st);
  } else {
    CITY_STATES.set(norm, [st]);
  }
}

// The shop's home state — used to break ties on ambiguous bare city names.
const HOME_STATE = (process.env.HOME_STATE || "UT").toLowerCase();

const ABBRS = Object.keys(STATE_NAMES); // AL … WY (+ DC)
const ABBR_SET = new Set(ABBRS);

// Uppercase-only two-letter state (lowercase "in"/"or"/"me" are just words).
// "OK" is excluded — notes are full of "…, OK to proceed" acknowledgments;
// Oklahoma still matches via its full name or the state+zip pattern.
const ABBR_RE = new RegExp(`\\b(${ABBRS.filter((a) => a !== "OK").join("|")})\\b`, "g");
// Full state names, longest first so "West Virginia" wins over "Virginia".
const FULL_NAMES = Object.values(STATE_NAMES).sort((a, b) => b.length - a.length);
const FULL_NAME_RE = new RegExp(`\\b(${FULL_NAMES.join("|")})\\b`, "gi");
// "UT 84003" — a zip is only trusted when a state abbreviation vouches for it
// (bare 5-digit numbers in notes are usually piano serial numbers or prices).
const STATE_ZIP_RE = new RegExp(`\\b(${ABBRS.join("|")})\\.?,?\\s+(\\d{5})(?:-\\d{4})?\\b`, "g");

/** Up to 4 words immediately before `end` in `text` (the candidate city). */
function precedingTokens(text: string, end: number): string[] {
  const before = text.slice(0, end).replace(/[,\s]+$/, "");
  const m = before.match(/((?:[A-Za-z][\w.'’-]*)(?:[ \t][A-Za-z][\w.'’-]*){0,3})$/);
  return m ? m[1].split(/[ \t]+/) : [];
}

// Words that are real town names somewhere but almost always mean something
// else in notes ("moving from North, SC" = northern South Carolina).
const CITY_STOPWORDS = new Set(["north", "south", "east", "west", "center", "central"]);

/** Try "city, ST" against the gazetteer, longest token run first. */
function lookupCity(tokens: string[], st: string): { coords: [number, number]; city: string } | null {
  for (let take = Math.min(4, tokens.length); take >= 1; take--) {
    const words = tokens.slice(tokens.length - take);
    const probe = normCity(words.join(" "));
    if (!probe || (take === 1 && CITY_STOPWORDS.has(probe))) continue;
    const coords = PLACE_INDEX.get(`${probe}|${st.toLowerCase()}`);
    if (coords) return { coords, city: words.join(" ") };
  }
  return null;
}

function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Best location mention in one text. Returns the highest-precision hit:
 * city → zip → state.
 */
function extractFromText(text: string): LeadGeo | null {
  if (!text || !text.trim()) return null;

  let zipHit: LeadGeo | null = null;
  let stateHit: LeadGeo | null = null;

  // 1) "City, ST" / "City ST" (and "City, Montana" via full names below).
  for (const m of text.matchAll(ABBR_RE)) {
    const st = m[1];
    const city = lookupCity(precedingTokens(text, m.index!), st);
    if (city) {
      return {
        lat: city.coords[0], lng: city.coords[1],
        place: `${titleCase(city.city)}, ${st}`,
        state: st, precision: "city",
      };
    }
  }
  for (const m of text.matchAll(FULL_NAME_RE)) {
    const st = NAME_TO_ABBR[m[1].toLowerCase()];
    if (!st) continue;
    const city = lookupCity(precedingTokens(text, m.index!), st);
    if (city) {
      return {
        lat: city.coords[0], lng: city.coords[1],
        place: `${titleCase(city.city)}, ${st}`,
        state: st, precision: "city",
      };
    }
  }

  // 2) "ST 84003" — state-vouched zip.
  for (const m of text.matchAll(STATE_ZIP_RE)) {
    const coords = ZIPS[m[2]];
    if (coords) {
      zipHit = {
        lat: coords[0], lng: coords[1],
        place: `${m[1]} ${m[2]}`,
        state: m[1], precision: "zip",
      };
      break;
    }
  }
  if (zipHit) return zipHit;

  // 3) Cue + bare city ("delivered in Lehi", "moving from Boise") — accepted
  //    only when that city name exists in exactly ONE state nationwide, so
  //    "in Springfield" (34 states) or a surname like "Foster" never pins.
  const CUE_CITY_RE = /\b(in|near|from|at|to|around|outside)\s+([A-Z][\w.'’-]*(?:[ \t][A-Z][\w.'’-]*){0,3})/g;
  // Cues that routinely precede PEOPLE ("spoke to Alex", "referred from
  // Matt") only count with multi-word candidates; a single capitalized word
  // needs a strictly locational cue ("in Lehi").
  const PLACE_ONLY_CUES = new Set(["in", "near", "around", "outside"]);
  for (const m of text.matchAll(CUE_CITY_RE)) {
    const tokens = m[2].split(/[ \t]+/);
    for (let take = tokens.length; take >= 1; take--) {
      if (take === 1 && !PLACE_ONLY_CUES.has(m[1].toLowerCase())) continue;
      const words = tokens.slice(0, take).join(" ");
      if (words.length < 4) continue;
      if (take === 1 && CITY_STOPWORDS.has(normCity(words))) continue;
      const norm = normCity(words);
      // Home state first — including the "… City" form ("West Valley" means
      // West Valley City, UT, not the hamlet of West Valley, NY). Then names
      // unique nationwide, then near-unique names that include home
      // (a Utah shop's "in Sandy" means Sandy, UT — not Sandy, PA).
      const states = CITY_STATES.get(norm);
      let key: string | null = null;
      if (PLACE_INDEX.has(`${norm}|${HOME_STATE}`)) key = `${norm}|${HOME_STATE}`;
      else if (PLACE_INDEX.has(`${norm} city|${HOME_STATE}`)) key = `${norm} city|${HOME_STATE}`;
      else if (states?.length === 1) key = `${norm}|${states[0]}`;
      if (key) {
        const st = key.split("|")[1].toUpperCase();
        const coords = PLACE_INDEX.get(key)!;
        return {
          lat: coords[0], lng: coords[1],
          place: `${titleCase(words)}, ${st}`,
          state: st, precision: "city",
        };
      }
    }
  }

  // 4) Bare state mention → centroid. Full names only, and only with a
  //    location-ish lead-in ("in Montana", "(Montana)", "to Georgia") so a
  //    customer named Virginia doesn't become a pin in Richmond.
  const CONTEXT_STATE_RE = new RegExp(
    `(?:^|[,(–—-]|\\bin\\b|\\bnear\\b|\\bfrom\\b|\\bto\\b|\\boutside\\b|\\barea of\\b)\\s*(${FULL_NAMES.join("|")})\\b`,
    "i"
  );
  const sm = text.match(CONTEXT_STATE_RE);
  if (sm) {
    const st = NAME_TO_ABBR[sm[1].toLowerCase()];
    const c = st && STATE_CENTROIDS[st];
    if (c) {
      stateHit = {
        lat: c[0], lng: c[1],
        place: `${STATE_NAMES[st]} (state)`,
        state: st, precision: "state",
      };
    }
  }
  return stateHit;
}

const PRECISION_RANK: Record<LeadGeo["precision"], number> = { city: 0, zip: 1, state: 2 };

/**
 * Best location across several text sources, in priority order
 * (pass headline first, then notes — earlier sources win ties).
 */
export function extractGeo(...texts: string[]): LeadGeo | null {
  let best: LeadGeo | null = null;
  for (const text of texts) {
    const hit = extractFromText(text);
    if (!hit) continue;
    if (hit.precision === "city") return hit; // can't do better
    if (!best || PRECISION_RANK[hit.precision] < PRECISION_RANK[best.precision]) best = hit;
  }
  return best;
}

/** Sanity check: is a state abbreviation valid? (exported for tests/UI) */
export function isStateAbbr(s: string): boolean {
  return ABBR_SET.has(s.toUpperCase());
}
