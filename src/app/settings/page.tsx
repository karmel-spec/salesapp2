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
    desc: "Sends approved text drafts from 801-769-0054 (A2P-registered).",
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
    key: "googleLogin",
    name: "Google sign-in for reps",
    desc: "Team members sign in with their @brighamlarsonpianos.com Google account — sends and edits carry their real name.",
    env: "GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET",
  },
  {
    key: "claudeFallback",
    name: "Claude API fallback drafts",
    desc: "Lets the app write drafts in Arnold's voice when his gateway is unreachable.",
    env: "ANTHROPIC_API_KEY",
  },
];

type BackupInfo = {
  configured: boolean;
  serviceAccount?: string;
  files: { id: string; name: string; createdTime: string; size?: string; webViewLink?: string }[];
};

function BackupsCard() {
  const [info, setInfo] = useState<BackupInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState("");

  const load = () => api<BackupInfo>("/api/backup").then(setInfo).catch(() => setInfo(null));
  useEffect(() => {
    load();
  }, []);

  async function backupNow() {
    setBusy(true);
    setFlash("");
    try {
      const r = await api<{ file: { name: string }; rows: number; pruned: number }>("/api/backup", { method: "POST" });
      setFlash(`✓ ${r.file.name} saved (${r.rows} rows${r.pruned ? `, ${r.pruned} old backup(s) pruned` : ""})`);
      load();
    } catch (e) {
      setFlash(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ marginBottom: 18 }}>
      <div style={{ display: "flex", alignItems: "baseline" }}>
        <h2>Leads Log backups</h2>
        <span className="spacer" style={{ flex: 1 }} />
        <button className="btn small" onClick={backupNow} disabled={busy || !info?.configured}>
          {busy ? "Backing up…" : "Back up now"}
        </button>
      </div>
      {flash && <div className="banner info">{flash}</div>}
      {!info && <div className="muted">Checking backups…</div>}
      {info && !info.configured && (
        <div className="muted">
          Nightly CSV backups go to a Google <b>Shared Drive</b> once connected (regular My Drive
          folders can&apos;t accept service-account uploads). Setup (one time):
          <ol style={{ margin: "6px 0 0", paddingLeft: 20 }}>
            <li>Google Drive → <b>Shared drives</b> (left sidebar) → + New → name it &quot;BLP Backups&quot;</li>
            <li>Open it → Manage members → add <code>{info.serviceAccount}</code> as <b>Content manager</b></li>
            <li>Set <code>DRIVE_BACKUP_FOLDER_ID</code> to the ID in the shared drive&apos;s URL, in Netlify env + redeploy</li>
          </ol>
        </div>
      )}
      {info && info.configured && (
        <>
          <div className="muted" style={{ marginBottom: 8 }}>
            Nightly at 2:15 AM · 30 most recent kept · every file is the complete sheet as CSV
          </div>
          {info.files.length === 0 && <div className="muted">No backups yet — click &quot;Back up now&quot; to create the first.</div>}
          {info.files.slice(0, 12).map((f) => (
            <div key={f.id} style={{ padding: "6px 0", borderBottom: "1px solid #f0ece6", display: "flex", gap: 10, alignItems: "baseline" }}>
              <a href={f.webViewLink} target="_blank" rel="noreferrer" style={{ textDecoration: "underline" }}>{f.name}</a>
              <span className="muted">{new Date(f.createdTime).toLocaleString()}{f.size ? ` · ${(Number(f.size) / 1024).toFixed(0)} KB` : ""}</span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

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
        <span className="sub">integration status, backups &amp; business rules</span>
      </div>

      <BackupsCard />

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
            {status.rules.staleDays}+ days without contact (10 for never-contacted new leads) → {status.rules.staleRep} joins as sub-rep (the Chief Sales
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
