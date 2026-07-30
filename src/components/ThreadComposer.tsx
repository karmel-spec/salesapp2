"use client";

import { useEffect, useState } from "react";
import type { Lead } from "@/lib/leads";
import { api, getWho } from "@/lib/client";

/**
 * Inline composer under a conversation thread: text, email, or call the
 * client without leaving the screen. "Templates" inserts a shared pre-made
 * message ({firstName}/{name}/{rep} placeholders filled in), and any draft
 * can be saved as a new template for the whole team.
 */

interface Template {
  id: string;
  name: string;
  channel: "sms" | "email" | "both";
  subject: string;
  body: string;
}

type Mode = "sms" | "email" | "call" | "note";

function fill(text: string, lead: Lead): string {
  return text
    .replace(/\{firstName\}/g, lead.firstName || lead.name.split(" ")[0] || "")
    .replace(/\{name\}/g, lead.name)
    .replace(/\{rep\}/g, getWho() === "app" ? "" : getWho());
}

export function ThreadComposer({ lead, onSent }: { lead: Lead; onSent: () => void }) {
  const [mode, setMode] = useState<Mode>(lead.phoneDialable ? "sms" : "email");
  const [body, setBody] = useState("");
  const [subject, setSubject] = useState("");
  const [repPhone, setRepPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState("");
  const [err, setErr] = useState("");
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [showTemplates, setShowTemplates] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [templateName, setTemplateName] = useState("");

  useEffect(() => {
    setRepPhone(localStorage.getItem("blp_rep_phone") || "");
  }, []);

  function loadTemplates() {
    if (templates === null) {
      api<{ templates: Template[] }>("/api/templates")
        .then((r) => setTemplates(r.templates))
        .catch(() => setTemplates([]));
    }
  }

  async function send() {
    setBusy(true);
    setErr("");
    try {
      if (mode === "note") {
        await api(`/api/leads/${encodeURIComponent(lead.id)}/timeline`, {
          method: "POST",
          body: JSON.stringify({ kind: "note", text: body, who: getWho() }),
        });
        setFlash("✓ Internal note saved to this lead's activity (the client never sees it)");
        setBody("");
        onSent();
      } else if (mode === "call") {
        localStorage.setItem("blp_rep_phone", repPhone);
        const r = await api<{ detail?: string }>(`/api/leads/${encodeURIComponent(lead.id)}/call`, {
          method: "POST",
          body: JSON.stringify({ repPhone, who: getWho() }),
        });
        setFlash(r.detail || "📞 Your phone rings first, then we dial the client.");
      } else {
        const r = await api<{ detail: string }>(`/api/leads/${encodeURIComponent(lead.id)}/send`, {
          method: "POST",
          body: JSON.stringify({ channel: mode, body, subject, who: getWho() }),
        });
        setFlash(`✓ ${r.detail}`);
        setBody("");
        setSubject("");
        onSent();
      }
      setTimeout(() => setFlash(""), 6000);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function saveTemplate() {
    setBusy(true);
    setErr("");
    try {
      const r = await api<{ template: Template }>("/api/templates", {
        method: "POST",
        body: JSON.stringify({
          name: templateName,
          channel: mode === "call" ? "both" : mode,
          subject,
          body,
          who: getWho(),
        }),
      });
      setTemplates((cur) => (cur ? [...cur, r.template].sort((a, b) => a.name.localeCompare(b.name)) : [r.template]));
      setSavingTemplate(false);
      setTemplateName("");
      setFlash(`✓ Template "${r.template.name}" saved for the whole team`);
      setTimeout(() => setFlash(""), 5000);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const visibleTemplates = (templates || []).filter((t) => t.channel === "both" || t.channel === mode);

  return (
    <div className="composer">
      <div className="composer-tabs">
        {(
          [
            ["sms", "💬 Text", Boolean(lead.phoneDialable), `no dialable number ("${lead.phone || "—"}")`],
            ["email", "✉️ Email", Boolean(lead.emailClean), `no valid email ("${lead.email || "—"}")`],
            ["call", "📞 Call", Boolean(lead.phoneDialable), "no dialable number"],
            ["note", "📝 Internal note", true, ""],
          ] as [Mode, string, boolean, string][]
        ).map(([m, label, enabled, why]) => (
          <button
            key={m}
            className={`btn small ${mode === m ? "" : "ghost"}`}
            disabled={!enabled}
            title={enabled ? undefined : why}
            onClick={() => setMode(m)}
          >
            {label}
          </button>
        ))}
        {(mode === "sms" || mode === "email") && (
          <div className="tpl-wrap">
            <button
              className="btn small ghost"
              onClick={() => {
                loadTemplates();
                setShowTemplates((v) => !v);
              }}
            >
              📋 Templates ▾
            </button>
            {showTemplates && (
              <div className="tpl-menu">
                {templates === null && <div className="muted" style={{ padding: 8 }}>Loading…</div>}
                {templates !== null && visibleTemplates.length === 0 && (
                  <div className="muted" style={{ padding: 8 }}>No {mode} templates yet — write one below and save it.</div>
                )}
                {visibleTemplates.map((t) => (
                  <button
                    key={t.id}
                    className="tpl-item"
                    onClick={() => {
                      setBody(fill(t.body, lead));
                      if (t.subject && mode === "email") setSubject(fill(t.subject, lead));
                      setShowTemplates(false);
                    }}
                  >
                    {t.name}
                  </button>
                ))}
                <button
                  className="tpl-item tpl-add"
                  onClick={() => {
                    setShowTemplates(false);
                    setSavingTemplate(true);
                  }}
                >
                  ＋ Save current message as a template…
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {flash && <div className="banner info" style={{ margin: "8px 0" }}>{flash}</div>}
      {err && <div className="banner bad" style={{ margin: "8px 0" }}>⚠ {err}</div>}

      {savingTemplate && (
        <div style={{ display: "flex", gap: 8, margin: "8px 0", alignItems: "center", flexWrap: "wrap" }}>
          <input
            placeholder="Template name (e.g. Restoration intro)"
            value={templateName}
            onChange={(e) => setTemplateName(e.target.value)}
            style={{ flex: 1, minWidth: 180 }}
            autoFocus
          />
          <button className="btn small" disabled={busy || !templateName.trim() || !body.trim()} onClick={saveTemplate}>
            Save template
          </button>
          <button className="btn small ghost" onClick={() => setSavingTemplate(false)}>✕</button>
          <span className="muted" style={{ fontSize: 11.5, width: "100%" }}>
            Tip: {"{firstName}"} in a template becomes the client&apos;s first name when inserted.
          </span>
        </div>
      )}

      {mode === "call" ? (
        <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input
            placeholder="Your cell (rings you first)"
            value={repPhone}
            onChange={(e) => setRepPhone(e.target.value)}
            style={{ minWidth: 190 }}
          />
          <button className="btn small" disabled={busy || repPhone.replace(/\D/g, "").length < 10} onClick={send}>
            {busy ? "Dialing…" : `📞 Call ${lead.name.split(" ")[0]}`}
          </button>
          <span className="muted" style={{ fontSize: 12 }}>
            store number shows as caller ID · the call logs to this conversation
          </span>
        </div>
      ) : (
        <>
          {mode === "email" && (
            <input
              placeholder="Subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              style={{ width: "100%", marginTop: 8 }}
            />
          )}
          <textarea
            rows={3}
            placeholder={
              mode === "note"
                ? "Internal note for the team — the client never sees this…"
                : mode === "email"
                  ? `Email ${lead.name.split(" ")[0]}…`
                  : `Text ${lead.name.split(" ")[0]}…`
            }
            value={body}
            onChange={(e) => setBody(e.target.value)}
            style={{ marginTop: 8 }}
          />
          <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
            <button
              className="btn small"
              disabled={busy || !body.trim() || (mode === "email" && !subject.trim())}
              onClick={send}
            >
              {busy ? "Saving…" : mode === "note" ? "Save note" : mode === "email" ? "Send email" : "Send text"}
            </button>
            <span className="muted" style={{ fontSize: 11.5 }}>
              {mode === "note"
                ? "team-only — saved to the lead's activity log"
                : `sends as ${getWho() === "app" ? "the team" : getWho()} · lands in this conversation`}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
