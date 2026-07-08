"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client";

type SyncStatus = {
  totalLeads: number;
  staleLeads: number;
  staleNotYetArnold: number;
  writeEnabled: boolean;
  integrations: Record<string, boolean>;
  rules: { staleDays: number; defaultRep: string; staleRep: string };
};

const INTEGRATIONS: { key: string; name: string; desc: string; env: string }[] = [
  {
    key: "sheetsWrite",
    name: "Google Sheets two-way sync",
    desc: "Reads work today via the share link. Writes need a service account with Editor access on the Leads Log.",
    env: "GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY",
  },
  {
    key: "auth",
    name: "Team passcode",
    desc: "Gates the whole console behind a shared passcode (BLP Mega App model).",
    env: "BLP_APP_ACCESS_KEY",
  },
  {
    key: "twilio",
    name: "Twilio SMS",
    desc: "Sends approved text drafts. Karmel is locating the texting number.",
    env: "TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER",
  },
  {
    key: "email",
    name: "Email from info@brighamlarsonpianos.com",
    desc: "SMTP via a Google Workspace app password for the info@ mailbox.",
    env: "SMTP_PASS (+ optional SMTP_USER/HOST/PORT)",
  },
  {
    key: "arnoldWebhook",
    name: "Arnold — Hermes webhook",
    desc: "Pings Arnold's gateway for drafts; he answers on /api/arnold/draft with his draft-only key.",
    env: "ARNOLD_WEBHOOK_URL, ARNOLD_WEBHOOK_SECRET, BLP_ARNOLD_ACCESS_KEY",
  },
  {
    key: "telegram",
    name: "Telegram notifications (@arnoldlarsonbot)",
    desc: "Team pings for new leads and stale-sweep handoffs.",
    env: "TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID",
  },
  {
    key: "claudeFallback",
    name: "Claude API fallback drafts",
    desc: "Lets the app write drafts in Arnold's voice when his gateway is unreachable.",
    env: "ANTHROPIC_API_KEY",
  },
];

export default function SettingsPage() {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api<SyncStatus>("/api/sync").then(setStatus).catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="banner bad">⚠ {error}</div>;
  if (!status) return <div className="spin">Checking integrations…</div>;

  return (
    <>
      <div className="page-head">
        <h1>Settings</h1>
        <span className="sub">integration status &amp; business rules</span>
      </div>

      <div className="card" style={{ marginBottom: 18 }}>
        <h2>Business rules</h2>
        <dl className="kv">
          <dt>Source of truth</dt>
          <dd>
            The <a style={{ textDecoration: "underline" }} href="https://docs.google.com/spreadsheets/d/1sdOeaChihEjAQBCi8U0_lTTlYP4H38eiC6zgmRLoWC0/edit" target="_blank" rel="noreferrer">Leads Log spreadsheet</a> — every read and write goes to the sheet.
          </dd>
          <dt>Default rep</dt>
          <dd>{status.rules.defaultRep} — every new lead is assigned to him first.</dd>
          <dt>Stale rule</dt>
          <dd>
            {status.rules.staleDays}+ days without contact → assigned to {status.rules.staleRep} (the Chief Sales
            Agent). Currently {status.staleLeads} stale, {status.staleNotYetArnold} still to hand over on the sheet.
          </dd>
          <dt>Human in the loop</dt>
          <dd>Arnold only drafts. A person approves every text and email before anything sends.</dd>
        </dl>
      </div>

      <div className="card">
        <h2>Integrations</h2>
        <div className="table-wrap" style={{ border: "none" }}>
          <table>
            <thead>
              <tr><th>Status</th><th>Integration</th><th>Env vars</th></tr>
            </thead>
            <tbody>
              {INTEGRATIONS.map((integration) => {
                const on = status.integrations[integration.key];
                return (
                  <tr key={integration.key} style={{ cursor: "default" }}>
                    <td>
                      <span className={`badge ${on ? "won" : "lost"}`}>{on ? "✓ Connected" : "○ Not configured"}</span>
                    </td>
                    <td>
                      <div className="lead-name">{integration.name}</div>
                      <div className="muted">{integration.desc}</div>
                    </td>
                    <td className="muted" style={{ fontFamily: "monospace", fontSize: 12 }}>{integration.env}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="muted" style={{ marginTop: 10 }}>
          Set these in <code>.env.local</code> (dev) or your host&apos;s environment settings. Full setup steps are in
          the repo README.
        </div>
      </div>
    </>
  );
}
