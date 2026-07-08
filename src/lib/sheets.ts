import crypto from "crypto";
import { config } from "./config";

/**
 * Google Sheets access layer.
 *
 * Two modes:
 *  - Full (service account creds present): reads AND writes via the Sheets
 *    REST API. The spreadsheet must be shared with the service account email
 *    as Editor.
 *  - Snapshot (no creds): reads via the public CSV export of the share link.
 *    Writes throw SheetsReadOnlyError so callers can surface a clear message.
 *
 * No SDK — the service-account JWT is signed with node:crypto and all calls
 * are plain fetch, keeping the dependency footprint tiny.
 */

export class SheetsReadOnlyError extends Error {
  constructor() {
    super(
      "Sheets write unavailable: set GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_PRIVATE_KEY, and share the Leads Log with the service account as Editor."
    );
    this.name = "SheetsReadOnlyError";
  }
}

let tokenCache: { token: string; exp: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (!config.googleClientEmail || !config.googlePrivateKey) throw new SheetsReadOnlyError();
  const now = Math.floor(Date.now() / 1000);
  if (tokenCache && tokenCache.exp > now + 60) return tokenCache.token;

  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const claims = Buffer.from(
    JSON.stringify({
      iss: config.googleClientEmail,
      scope: "https://www.googleapis.com/auth/spreadsheets",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    })
  ).toString("base64url");
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  const signature = signer.sign(config.googlePrivateKey).toString("base64url");

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${header}.${claims}.${signature}`,
    }),
  });
  if (!res.ok) throw new Error(`Google token exchange failed (${res.status}): ${await res.text()}`);
  const json = (await res.json()) as { access_token: string; expires_in: number };
  tokenCache = { token: json.access_token, exp: now + json.expires_in };
  return json.access_token;
}

async function api(path: string, init?: RequestInit): Promise<any> {
  const token = await getAccessToken();
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${config.sheetId}${path}`,
    {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(init?.headers || {}),
      },
    }
  );
  if (!res.ok) throw new Error(`Sheets API ${path} failed (${res.status}): ${await res.text()}`);
  return res.json();
}

let tabCache: string | null = null;

/** First tab title, or the configured SHEET_TAB. */
export async function getTabName(): Promise<string> {
  if (config.sheetTab) return config.sheetTab;
  if (tabCache) return tabCache;
  const meta = await api("?fields=sheets.properties.title");
  tabCache = meta.sheets?.[0]?.properties?.title || "Sheet1";
  return tabCache!;
}

export function canWrite(): boolean {
  return Boolean(config.googleClientEmail && config.googlePrivateKey);
}

/** All rows (including header) as a string matrix. */
export async function readRows(): Promise<string[][]> {
  if (canWrite()) {
    const tab = await getTabName();
    const data = await api(`/values/${encodeURIComponent(tab)}?majorDimension=ROWS`);
    return (data.values || []) as string[][];
  }
  // Snapshot mode: public CSV export of the share link.
  const res = await fetch(
    `https://docs.google.com/spreadsheets/d/${config.sheetId}/export?format=csv`,
    { redirect: "follow", cache: "no-store" }
  );
  if (!res.ok) throw new Error(`CSV export failed (${res.status}) — is the sheet link-shared?`);
  return parseCsv(await res.text());
}

/** Column index (0-based) → A1 letter(s). */
export function colLetter(i: number): string {
  let s = "";
  let n = i + 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/**
 * Write individual cells. `rowNumber` is the 1-based sheet row.
 * Cells: [{ row, col, value }] with col 0-based.
 */
export async function writeCells(
  cells: { row: number; col: number; value: string }[]
): Promise<void> {
  if (!canWrite()) throw new SheetsReadOnlyError();
  const tab = await getTabName();
  await api(`/values:batchUpdate`, {
    method: "POST",
    body: JSON.stringify({
      valueInputOption: "RAW",
      data: cells.map((c) => ({
        range: `${tab}!${colLetter(c.col)}${c.row}`,
        values: [[c.value]],
      })),
    }),
  });
}

/** Append a full row to the bottom of the sheet. */
export async function appendRow(values: string[]): Promise<void> {
  if (!canWrite()) throw new SheetsReadOnlyError();
  const tab = await getTabName();
  await api(`/values/${encodeURIComponent(tab)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
    method: "POST",
    body: JSON.stringify({ values: [values] }),
  });
}

/** Minimal RFC-4180 CSV parser (quoted fields, embedded newlines). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}
