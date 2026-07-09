/**
 * Central configuration. Everything integrates through env vars so the app
 * degrades gracefully: with no credentials it still runs in read-only
 * "snapshot mode" against the sheet's public CSV export.
 */
export const config = {
  // The Leads Log spreadsheet — the single source of truth.
  sheetId: process.env.SHEET_ID || "1sdOeaChihEjAQBCi8U0_lTTlYP4H38eiC6zgmRLoWC0",
  sheetTab: process.env.SHEET_TAB || "", // blank = first tab, autodetected

  // Google service account (share the sheet with this email as Editor to
  // unlock two-way sync; without it the app is read-only).
  googleClientEmail: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || "",
  googlePrivateKey: (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),

  // Shared team passcode gating the whole app (same model as BLP Mega App).
  accessKey: process.env.BLP_APP_ACCESS_KEY || "",

  // Arnold — Chief Sales Agent (Hermes profile `arnold`, Telegram @arnoldlarsonbot)
  arnoldWebhookUrl: process.env.ARNOLD_WEBHOOK_URL || "", // Hermes gateway endpoint
  arnoldWebhookSecret: process.env.ARNOLD_WEBHOOK_SECRET || "", // HMAC shared secret
  arnoldDraftKey: process.env.BLP_ARNOLD_ACCESS_KEY || "", // draft-only key Arnold uses to call US
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || "", // @arnoldlarsonbot token (for team notifications)
  telegramChatId: process.env.TELEGRAM_CHAT_ID || "", // sales team chat/group id

  // Outbound comms
  twilioAccountSid: process.env.TWILIO_ACCOUNT_SID || "",
  twilioAuthToken: process.env.TWILIO_AUTH_TOKEN || "",
  twilioFrom: process.env.TWILIO_FROM_NUMBER || "", // texting number (801-769-0054)
  // Verified caller ID shown to customers on bridge calls — the public store line.
  twilioCallerId: process.env.TWILIO_CALLER_ID_NUMBER || "+18017010113",
  // A2P-registered messaging service ("Default Messaging Service for
  // Conversations") — sending through it adds automatic STOP/opt-out handling.
  twilioMessagingServiceSid:
    process.env.TWILIO_MESSAGING_SERVICE_SID || "MGe711705877a15112a65e08f6b6e8442d",
  smtpHost: process.env.SMTP_HOST || "smtp.gmail.com",
  smtpPort: Number(process.env.SMTP_PORT || 465),
  smtpUser: process.env.SMTP_USER || "info@brighamlarsonpianos.com",
  smtpPass: process.env.SMTP_PASS || "", // Google Workspace app password
  emailFromName: process.env.EMAIL_FROM_NAME || "Brigham Larson Pianos",

  // Optional: lets the app generate drafts in Arnold's voice directly via the
  // Claude API when the Hermes webhook isn't reachable.
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || "",

  // Safety: without a team passcode the app is in open/dev mode — real
  // customer sends are disabled there unless explicitly forced.
  dryRunSends:
    process.env.DRY_RUN_SENDS === "1" ||
    (!process.env.BLP_APP_ACCESS_KEY && process.env.DRY_RUN_SENDS !== "0"),

  // Google Drive folder (shared with the service account) for Leads Log
  // backups. Accepts a bare ID, a full folder URL, or an ID with ?usp=…
  // link suffix — humans paste all three.
  driveBackupFolderId: (process.env.DRIVE_BACKUP_FOLDER_ID || "")
    .split("?")[0]
    .split("/")
    .filter(Boolean)
    .pop() || "",

  // Google sign-in for reps (domain-restricted OAuth)
  googleOauthClientId: process.env.GOOGLE_OAUTH_CLIENT_ID || "",
  googleOauthClientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET || "",
  googleAllowedDomain: process.env.GOOGLE_ALLOWED_DOMAIN || "brighamlarsonpianos.com",
  googleAllowedEmails: (process.env.GOOGLE_ALLOWED_EMAILS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
  publicBaseUrl: process.env.PUBLIC_BASE_URL || "https://blpsalesapp.netlify.app",

  // Business rules
  staleDays: Number(process.env.STALE_DAYS || 30), // worked leads: quiet this long → Arnold
  newLeadStaleDays: Number(process.env.NEW_LEAD_STALE_DAYS || 10), // never-contacted new leads → Arnold sooner
  defaultRep: process.env.DEFAULT_REP || "Brigham",
  staleRep: process.env.STALE_REP || "Arnold",
};

export function integrationStatus() {
  return {
    sheetsWrite: Boolean(config.googleClientEmail && config.googlePrivateKey),
    auth: Boolean(config.accessKey),
    twilio: Boolean(config.twilioAccountSid && config.twilioAuthToken && config.twilioFrom),
    email: Boolean(config.smtpPass),
    arnoldWebhook: Boolean(config.arnoldWebhookUrl),
    telegram: Boolean(config.telegramBotToken && config.telegramChatId),
    claudeFallback: Boolean(config.anthropicApiKey),
    googleLogin: Boolean(config.googleOauthClientId && config.googleOauthClientSecret),
  };
}
