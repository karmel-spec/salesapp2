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

export function isValidSession(cookieValue: string | undefined): boolean {
  if (!config.accessKey) return true; // open mode
  return cookieValue === sessionToken();
}

/** Draft-only key for Arnold's webhook calls (never grants full app access). */
export function isValidArnoldKey(headerValue: string | null): boolean {
  if (!config.arnoldDraftKey) return false;
  if (!headerValue) return false;
  const a = Buffer.from(headerValue);
  const b = Buffer.from(config.arnoldDraftKey);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
