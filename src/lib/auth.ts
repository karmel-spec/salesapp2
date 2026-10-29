import crypto from "crypto";
import { config } from "./config";

/**
 * Shared-passcode auth (same model as the BLP Mega App): one team passcode in
 * BLP_APP_ACCESS_KEY. The session cookie stores an HMAC of the passcode so
 * rotating the env var invalidates all sessions. If no passcode is configured
 * the app runs open (local dev).
 */

export const SESSION_COOKIE = "blp_session";

export function sessionToken(): string {
  return crypto.createHmac("sha256", "blp-sales-session").update(config.accessKey).digest("hex");
}

export function checkPasscode(passcode: string): boolean {
  if (!config.accessKey) return true;
  const a = Buffer.from(passcode);
  const b = Buffer.from(config.accessKey);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function sessionSecret(): string {
  return config.accessKey || "blp-open-mode";
}

/** Signed, named session for Google-authenticated reps: g.<payload>.<sig>
 *  (bots use the same shape with a b. prefix — see botSessionToken). */
export function googleSessionToken(name: string, email: string, prefix: "g" | "b" = "g", days = 30): string {
  const payload = Buffer.from(
    JSON.stringify({ n: name, e: email, exp: Date.now() + days * 86400_000 })
  ).toString("base64url");
  const sig = crypto.createHmac("sha256", sessionSecret()).update(`${prefix}.${payload}`).digest("hex");
  return `${prefix}.${payload}.${sig}`;
}

export function parseGoogleSession(cookieValue: string | undefined): { name: string; email: string; bot?: boolean } | null {
  if (!cookieValue || !/^[gb]\./.test(cookieValue)) return null;
  const [prefix, payload, sig] = cookieValue.split(".");
  if (!payload || !sig) return null;
  const expected = crypto.createHmac("sha256", sessionSecret()).update(`${prefix}.${payload}`).digest("hex");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString()) as { n: string; e: string; exp: number };
    if (data.exp < Date.now()) return null;
    return { name: data.n, email: data.e, ...(prefix === "b" ? { bot: true } : {}) };
  } catch {
    return null;
  }
}

export function isValidSession(cookieValue: string | undefined): boolean {
  if (!config.accessKey) return true; // open mode
  if (cookieValue === sessionToken()) return true; // legacy shared passcode
  return parseGoogleSession(cookieValue) !== null; // named Google session
}

/** Draft-only key for Arnold's webhook calls (never grants full app access). */
export function isValidArnoldKey(headerValue: string | null): boolean {
  if (!config.arnoldDraftKey) return false;
  if (!headerValue) return false;
  const a = Buffer.from(headerValue);
  const b = Buffer.from(config.arnoldDraftKey);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/* ── Grok Bot admin team (Brigham 10/29) ──────────────────────────────────
   One token per bot, derived from BLP_BOT_SECRET and the bot's name. The
   token is both the bot's sign-in link (/api/auth/bot?token=…, which sets a
   90-day named session cookie) and its x-blp-key for every API route. */

/** Display name for a bot slug: "clarence" → "Clarence (bot)". */
export function botDisplayName(slug: string): string {
  return `${slug.charAt(0).toUpperCase()}${slug.slice(1)} (bot)`;
}

/** The bot's token, or "" when BLP_BOT_SECRET isn't set. Shape: <slug>.<40 hex>. */
export function botToken(slug: string): string {
  if (!config.botSecret) return "";
  const s = slug.trim().toLowerCase();
  if (!config.bots.includes(s)) return "";
  return `${s}.${crypto.createHmac("sha256", config.botSecret).update(`bot:${s}`).digest("hex").slice(0, 40)}`;
}

/** Which bot (slug) a token belongs to, or null. Constant-time compare. */
export function botFromToken(token: string | null | undefined): string | null {
  if (!token || !config.botSecret) return null;
  const slug = token.split(".")[0]?.toLowerCase();
  if (!slug) return null;
  const expected = botToken(slug);
  if (!expected) return null;
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return slug;
}

/** Signed 90-day session for a bot (b.<payload>.<sig>), accepted by isValidSession. */
export function botSessionToken(slug: string): string {
  return googleSessionToken(botDisplayName(slug), `${slug}@bots.brighamlarsonpianos.com`, "b", 90);
}

/** A bot's x-blp-key / Bearer token on an API request → its slug, or null. */
export function botFromRequest(req: { headers: { get(name: string): string | null } }): string | null {
  const h = req.headers.get("x-blp-key") || (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "") || null;
  return botFromToken(h);
}
