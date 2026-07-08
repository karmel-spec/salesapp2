# BLP Sales Console

Sales process webapp for **Brigham Larson Pianos**. The [Leads Log spreadsheet](https://docs.google.com/spreadsheets/d/1sdOeaChihEjAQBCi8U0_lTTlYP4H38eiC6zgmRLoWC0/edit) is the **single source of truth** — the app reads it live and writes every change straight back, so the sheet and the app can never drift apart.

Built with Next.js 15 + TypeScript, styled after brighamlarsonpianos.com (deep crimson, ink, warm paper, serif display).

## What it does

- **Two-way Google Sheets sync** — reads all 24 Leads Log columns (discovering positions from the header, so inserting columns won't break it); writes edits, new leads, timeline events, and rep reassignments back to specific cells. With no credentials it still boots in read-only snapshot mode via the sheet's share link.
- **Assignment rules** — new leads default to **Brigham**; any open lead with **30+ days since last contact** is assigned to **Arnold**, the AI Chief Sales Agent. The rule shows live everywhere, and the Dashboard's "Run Arnold stale sweep" persists it to the sheet (and pings the team on Telegram).
- **Arnold AI drafts with human approval** — for each lead, Arnold suggests the next **text** and **email**. A human reviews/edits in the Approvals queue, and only on approval does the app actually send — texts via **Twilio**, emails from **info@brighamlarsonpianos.com** via SMTP. Every send is logged to the lead's timeline and bumps Date of Last Contact.
- **Arnold integration, three ways**
  1. **Hermes webhook** — "Ask Arnold" pings `ARNOLD_WEBHOOK_URL` (HMAC-signed); Arnold answers by POSTing drafts to `/api/arnold/draft` using his **draft-only** key (rejected for anything else).
  2. **Telegram** — humans chat with Arnold at [@arnoldlarsonbot](https://t.me/arnoldlarsonbot); the app posts new-lead and stale-sweep notifications via the bot.
  3. **Claude API fallback** — with `ANTHROPIC_API_KEY` set, the app writes drafts in Arnold's voice itself when the Hermes gateway is unreachable.
- **Lead management** — searchable/filterable lead table, full detail view with editable fields, activity timeline (readable `App Activity` text + structured `timeline_data_json`, same schema as the BLP Mega App), dedupe-guarded lead creation.

## Run it

```bash
npm install
cp .env.example .env.local   # fill in what you have — everything is optional
npm run dev                  # http://localhost:8790
```

## Setup checklist (each unlocks a feature)

| Feature | What to do |
|---|---|
| Two-way sync | Create a Google Cloud service account with the Sheets API enabled, share the Leads Log with it as **Editor**, set `GOOGLE_SERVICE_ACCOUNT_EMAIL` + `GOOGLE_PRIVATE_KEY` |
| Team login | Set `BLP_APP_ACCESS_KEY` to the shared passcode |
| Text sending | Set `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` |
| Email sending | Create an app password for info@brighamlarsonpianos.com, set `SMTP_PASS` |
| Arnold (Hermes) | Set `ARNOLD_WEBHOOK_URL`, `ARNOLD_WEBHOOK_SECRET`, `BLP_ARNOLD_ACCESS_KEY` |
| Telegram pings | Set `TELEGRAM_BOT_TOKEN` (@arnoldlarsonbot) + `TELEGRAM_CHAT_ID` |
| AI fallback drafts | Set `ANTHROPIC_API_KEY` |

The **Settings** page in the app shows which integrations are live.

## Arnold webhook contract

Arnold pushes drafts to the app:

```
POST /api/arnold/draft
x-blp-key: <BLP_ARNOLD_ACCESS_KEY>
x-blp-signature: <hex HMAC-SHA256 of raw body with ARNOLD_WEBHOOK_SECRET>

{ "leadId": "blp-…", "drafts": [
    { "channel": "sms",   "body": "…" },
    { "channel": "email", "subject": "…", "body": "…" }
] }
```

The app pings Arnold (on "Ask Arnold" and for new/stale leads):

```
POST <ARNOLD_WEBHOOK_URL>
X-BLP-Signature: <hex HMAC-SHA256 of raw body>

{ "event": "draft_request", "lead": { "id", "name", "headline", "notes", … } }
```

## Key routes

| Route | Purpose |
|---|---|
| `/` | Dashboard — pipeline tiles, Arnold's queue, stale sweep |
| `/leads`, `/leads/[id]` | Lead table / detail + timeline + drafts |
| `/approvals` | Every pending Arnold draft, approve → send |
| `/settings` | Integration status + business rules |
| `POST /api/arnold/draft` | Arnold pushes drafts (draft-only key + HMAC) |
| `POST /api/arnold/ask` | Request drafts (webhook first, Claude fallback) |
| `POST /api/sync` | Stale sweep: persist 30-day → Arnold rule to the sheet |
