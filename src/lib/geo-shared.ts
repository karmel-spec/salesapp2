/**
 * Client-safe geography constants and types for the Lead Map.
 * (Keep the big place/ZIP lookup tables out of here — they live in geo.ts,
 * which is server-only so the datasets never reach the browser bundle.)
 */

export const STATE_NAMES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
  CO: "Colorado", CT: "Connecticut", DE: "Delaware", DC: "District of Columbia",
  FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois",
  IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana",
  ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan",
  MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana",
  NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey",
  NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota",
  OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania",
  RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota",
  TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia",
  WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
};

export const NAME_TO_ABBR: Record<string, string> = Object.fromEntries(
  Object.entries(STATE_NAMES).map(([abbr, name]) => [name.toLowerCase(), abbr])
);

/** Geographic centers, used when a lead only mentions a state. */
export const STATE_CENTROIDS: Record<string, [number, number]> = {
  AL: [32.79, -86.83], AK: [64.07, -152.28], AZ: [34.27, -111.66],
  AR: [34.89, -92.44], CA: [37.18, -119.47], CO: [38.99, -105.55],
  CT: [41.62, -72.73], DE: [38.99, -75.51], DC: [38.91, -77.01],
  FL: [28.63, -82.45], GA: [32.64, -83.44], HI: [20.29, -156.37],
  ID: [44.35, -114.61], IL: [40.04, -89.2], IN: [39.89, -86.28],
  IA: [42.08, -93.5], KS: [38.49, -98.38], KY: [37.53, -85.3],
  LA: [31.07, -92.0], ME: [45.37, -69.24], MD: [39.06, -76.8],
  MA: [42.26, -71.81], MI: [44.35, -85.41], MN: [46.28, -94.31],
  MS: [32.74, -89.67], MO: [38.35, -92.46], MT: [47.05, -109.63],
  NE: [41.54, -99.8], NV: [39.33, -116.63], NH: [43.68, -71.58],
  NJ: [40.19, -74.67], NM: [34.41, -106.11], NY: [42.95, -75.53],
  NC: [35.56, -79.39], ND: [47.45, -100.47], OH: [40.29, -82.79],
  OK: [35.58, -97.51], OR: [43.93, -120.56], PA: [40.88, -77.8],
  RI: [41.68, -71.56], SC: [33.92, -80.9], SD: [44.44, -100.23],
  TN: [35.86, -86.35], TX: [31.48, -99.33], UT: [39.31, -111.67],
  VT: [44.07, -72.67], VA: [37.52, -78.85], WA: [47.38, -120.45],
  WV: [38.64, -80.62], WI: [44.62, -89.99], WY: [43.0, -107.55],
};

export type GeoPrecision = "city" | "zip" | "state";

export interface LeadGeo {
  lat: number;
  lng: number;
  /** Human label for the matched location, e.g. "McLean, VA" or "Utah (state)". */
  place: string;
  state: string; // two-letter abbreviation
  precision: GeoPrecision;
}

/** What the /api/map endpoint returns per lead — enough to pin and preview. */
export interface MapLead {
  id: string;
  name: string;
  headline: string;
  statusBucket: string;
  isStale: boolean;
  rep: string;
  subRep: string;
  score: string;
  value: string;
  leadType: string;
  pianoType: string;
  daysSinceContact: number | null;
  geo: LeadGeo | null;
}
