"use client";

import { useEffect, useRef, useState } from "react";
import type { Lead, LeadPhone } from "@/lib/leads";
import { api, getWho } from "@/lib/client";

/**
 * Dialer (Brigham 11/4): call a lead — or ANY number connected to them (a
 * spouse, an assistant, a new cell) — straight from the lead page.
 *
 *  • "From this computer": WebRTC via the Twilio Voice SDK. No cell phone,
 *    no Plaud. Store caller ID, recorded, transcript + summary file onto the
 *    lead when the call ends (/api/twilio/outbound → /api/twilio/recording).
 *  • "Ring my cell first": the original bridge call (/api/leads/[id]/call),
 *    for when the rep is away from a computer with a mic.
 *
 * The keypad types a number before the call and sends touch-tones during
 * it (phone menus, extensions). A typed number can be saved onto the lead
 * with a label so it's one click next time.
 */

type VoiceInfo = { configured: boolean; token?: string; identity?: string; expiresAt?: string; callerId: string; reason?: string };
type CallState = "idle" | "connecting" | "ringing" | "live" | "ended";
type Mode = "browser" | "cell";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"];
const fmt = (d: string) => {
  const x = d.replace(/\D/g, "").replace(/^1(\d{10})$/, "$1");
  if (x.length <= 3) return x;
  if (x.length <= 6) return `${x.slice(0, 3)}-${x.slice(3)}`;
  return `${x.slice(0, 3)}-${x.slice(3, 6)}-${x.slice(6, 10)}`;
};
const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

// Twilio Voice SDK surface we touch (loaded on demand — it's browser-only).
type TwilioCall = {
  on: (ev: string, fn: (arg?: unknown) => void) => void;
  disconnect: () => void;
  mute: (m: boolean) => void;
  sendDigits: (d: string) => void;
};
type TwilioDevice = {
  connect: (opts: { params: Record<string, string> }) => Promise<TwilioCall>;
  destroy: () => void;
  on: (ev: string, fn: (arg?: unknown) => void) => void;
};

export function Dialer({
  lead,
  inline = false,
  onFlash,
  onDone,
}: {
  lead: Lead;
  inline?: boolean; // rendered inside the thread composer (always open)
  onFlash?: (s: string) => void;
  onDone?: () => void;
}) {
  const [open, setOpen] = useState(inline);
  const [voice, setVoice] = useState<VoiceInfo | null>(null);
  const [mode, setMode] = useState<Mode>("browser");
  const [phones, setPhones] = useState<LeadPhone[]>(lead.phones);
  const [target, setTarget] = useState<string>(lead.phoneDialable || "custom"); // a dialable, or "custom"
  const [custom, setCustom] = useState("");
  const [pad, setPad] = useState(false);
  const [saveLabel, setSaveLabel] = useState("");
  const [saving, setSaving] = useState(false);
  const [repPhone, setRepPhone] = useState("");
  const [state, setState] = useState<CallState>("idle");
  const [muted, setMuted] = useState(false);
  const [secs, setSecs] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [tones, setTones] = useState("");
  const deviceRef = useRef<TwilioDevice | null>(null);
  const callRef = useRef<TwilioCall | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => setPhones(lead.phones), [lead.phones]);
  useEffect(() => {
    setRepPhone(localStorage.getItem("blp_rep_phone") || "");
    const m = localStorage.getItem("blp_call_mode");
    if (m === "cell" || m === "browser") setMode(m);
  }, []);

  // Token on open (cheap; a fresh one each time the dialer opens).
  useEffect(() => {
    if (!open || voice) return;
    api<VoiceInfo>(`/api/twilio/token?who=${encodeURIComponent(getWho())}`)
      .then((v) => {
        setVoice(v);
        if (!v.configured) setMode("cell");
      })
      .catch((e) => setVoice({ configured: false, callerId: "", reason: e instanceof Error ? e.message : String(e) }));
  }, [open, voice]);

  useEffect(() => () => { deviceRef.current?.destroy(); if (timerRef.current) clearInterval(timerRef.current); }, []);

  const flash = (s: string) => onFlash?.(s);
  const customDialable = (() => {
    const d = custom.replace(/\D/g, "");
    return d.length === 10 ? `+1${d}` : d.length === 11 && d.startsWith("1") ? `+${d}` : "";
  })();
  const dialTo = target === "custom" ? customDialable : target;
  const dialLabel = (() => {
    if (target === "custom") return fmt(custom) || "—";
    const p = phones.find((x) => x.dialable === target);
    return p ? `${p.label ? `${p.label} · ` : ""}${p.number}` : target;
  })();
  const inCall = state === "connecting" || state === "ringing" || state === "live";

  function press(k: string) {
    if (inCall) {
      callRef.current?.sendDigits(k);
      setTones((t) => t + k);
    } else {
      setTarget("custom");
      setCustom((c) => (c.replace(/\D/g, "").length >= 11 ? c : c + k));
    }
  }

  function startTimer() {
    setSecs(0);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => setSecs((s) => s + 1), 1000);
  }
  function endCall(note?: string) {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    callRef.current = null;
    setState("ended");
    setMuted(false);
    setTones("");
    if (note) flash(note);
    onDone?.();
  }

  async function callFromBrowser() {
    setErr("");
    if (!voice?.configured || !voice.token) { setErr(voice?.reason || "Browser calling isn't configured"); return; }
    if (!dialTo) { setErr("Enter a 10-digit number to call"); return; }
    setBusy(true);
    try {
      const { Device } = await import("@twilio/voice-sdk");
      if (!deviceRef.current) {
        const dev = new Device(voice.token, { codecPreferences: ["opus", "pcmu"] as never, closeProtection: true }) as unknown as TwilioDevice;
        dev.on("error", (e) => { setErr(`Twilio: ${(e as { message?: string })?.message || String(e)}`); endCall(); });
        deviceRef.current = dev;
      }
      setState("connecting");
      const call = await deviceRef.current.connect({ params: { To: dialTo, LeadId: lead.id, Who: getWho() } });
      callRef.current = call;
      call.on("ringing", () => setState("ringing"));
      call.on("accept", () => { setState("live"); startTimer(); });
      call.on("disconnect", () => endCall(`📞 Call with ${dialLabel} ended${secs ? ` after ${clock(secs)}` : ""} — the recording, transcript and summary file onto this lead in a minute or two.`));
      call.on("cancel", () => endCall());
      call.on("reject", () => endCall("Call was rejected."));
      call.on("error", (e) => { setErr(`Call error: ${(e as { message?: string })?.message || String(e)}`); endCall(); });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setState("idle");
    } finally {
      setBusy(false);
    }
  }

  async function callViaCell() {
    setErr("");
    if (!dialTo) { setErr("Enter a 10-digit number to call"); return; }
    setBusy(true);
    try {
      localStorage.setItem("blp_rep_phone", repPhone);
      const r = await api<{ detail: string }>(`/api/leads/${encodeURIComponent(lead.id)}/call`, {
        method: "POST",
        body: JSON.stringify({ repPhone, who: getWho(), to: dialTo }),
      });
      flash(`📞 ${r.detail}`);
      if (!inline) setOpen(false);
      onDone?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function saveNumber() {
    if (!customDialable) return;
    setSaving(true);
    setErr("");
    try {
      const r = await api<{ phones: LeadPhone[]; detail: string }>(`/api/leads/${encodeURIComponent(lead.id)}/phones`, {
        method: "POST",
        body: JSON.stringify({ number: customDialable, label: saveLabel, who: getWho() }),
      });
      setPhones(r.phones);
      setTarget(customDialable);
      setCustom("");
      setSaveLabel("");
      flash(`✓ ${r.detail}`);
      onDone?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  function pickMode(m: Mode) {
    setMode(m);
    localStorage.setItem("blp_call_mode", m);
  }

  if (!open) {
    return <button className="btn ghost" onClick={() => setOpen(true)} title="Call this lead, or any number connected to them">📞 Call</button>;
  }

  const first = lead.name.split(" ")[0] || lead.name;
  const box: React.CSSProperties = inline
    ? { marginTop: 8 }
    : { border: "1px solid var(--line, #d9d2c4)", borderRadius: 10, padding: "10px 12px", background: "var(--paper-2, #faf7f1)", width: "100%" };

  return (
    <div style={box} data-dialer>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <strong style={{ fontSize: 14 }}>📞 Call {first}</strong>
        <span style={{ display: "inline-flex", gap: 0, border: "1px solid #cfc6b5", borderRadius: 6, overflow: "hidden" }}>
          {([["browser", "From this computer"], ["cell", "Ring my cell first"]] as [Mode, string][]).map(([m, label]) => (
            <button
              key={m}
              type="button"
              className="btn small ghost"
              disabled={inCall || (m === "browser" && voice !== null && !voice.configured)}
              onClick={() => pickMode(m)}
              style={{ borderRadius: 0, border: 0, background: mode === m ? "#7a1f2b" : "transparent", color: mode === m ? "#fff" : undefined }}
              title={m === "browser" && voice && !voice.configured ? voice.reason : undefined}
            >
              {label}
            </button>
          ))}
        </span>
        {voice && !voice.configured && (
          <span className="muted" style={{ fontSize: 12 }} title={voice.reason}>computer calling not set up yet — see Settings</span>
        )}
        <span className="spacer" />
        {!inline && !inCall && <button className="btn ghost small" onClick={() => setOpen(false)}>✕</button>}
      </div>

      {/* Who to call */}
      <div style={{ display: "flex", gap: 12, marginTop: 8, alignItems: "center", flexWrap: "wrap" }}>
        {phones.map((p) => (
          <label key={p.dialable} style={{ display: "inline-flex", gap: 5, alignItems: "center", fontSize: 13, cursor: "pointer" }}>
            <input type="radio" name={`dial-${lead.id}`} disabled={inCall} checked={target === p.dialable} onChange={() => setTarget(p.dialable)} />
            {p.label ? `${p.label} · ` : ""}{p.number}
          </label>
        ))}
        <label style={{ display: "inline-flex", gap: 5, alignItems: "center", fontSize: 13, cursor: "pointer" }}>
          <input type="radio" name={`dial-${lead.id}`} disabled={inCall} checked={target === "custom"} onChange={() => setTarget("custom")} />
          Other number
        </label>
        <input
          placeholder="e.g. 801-555-1234"
          inputMode="tel"
          value={custom}
          disabled={inCall}
          onFocus={() => setTarget("custom")}
          onChange={(e) => { setTarget("custom"); setCustom(e.target.value); }}
          style={{ width: 150 }}
        />
        <button type="button" className="btn ghost small" onClick={() => setPad((p) => !p)} title={inCall ? "Touch-tone keypad (menus, extensions)" : "Type a number"}>
          {pad ? "Hide keypad" : "⌨ Keypad"}
        </button>
      </div>

      {/* Save a typed number onto the lead */}
      {target === "custom" && customDialable && !inCall && (
        <div style={{ display: "flex", gap: 6, marginTop: 6, alignItems: "center", flexWrap: "wrap" }}>
          <span className="muted" style={{ fontSize: 12.5 }}>Save {fmt(custom)} to {first}&apos;s lead as</span>
          <input placeholder="label — husband Rick, assistant…" value={saveLabel} onChange={(e) => setSaveLabel(e.target.value)} style={{ width: 200 }} />
          <button type="button" className="btn ghost small" disabled={saving} onClick={saveNumber}>{saving ? "Saving…" : "Save number"}</button>
        </div>
      )}

      {pad && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 56px)", gap: 6, marginTop: 8 }}>
          {KEYS.map((k) => (
            <button key={k} type="button" className="btn ghost" onClick={() => press(k)} style={{ height: 40, fontSize: 18, fontWeight: 600, padding: 0 }}>
              {k}
            </button>
          ))}
          {!inCall && (
            <button type="button" className="btn ghost small" onClick={() => setCustom((c) => c.slice(0, -1))} style={{ gridColumn: "span 3" }}>⌫ delete</button>
          )}
          {inCall && tones && <span className="muted" style={{ gridColumn: "span 3", fontSize: 12 }}>sent: {tones}</span>}
        </div>
      )}

      {/* Action row */}
      <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center", flexWrap: "wrap" }}>
        {mode === "cell" && !inCall && (
          <input placeholder="Your cell (rings you first)" inputMode="tel" value={repPhone} onChange={(e) => setRepPhone(e.target.value)} style={{ minWidth: 190 }} />
        )}
        {!inCall ? (
          <button
            className="btn small"
            disabled={busy || !dialTo || (mode === "cell" && repPhone.replace(/\D/g, "").length < 10) || (mode === "browser" && (!voice || !voice.configured))}
            onClick={mode === "browser" ? callFromBrowser : callViaCell}
          >
            {busy ? "Dialing…" : `📞 Call ${dialLabel}`}
          </button>
        ) : (
          <>
            <span style={{ fontWeight: 600, fontSize: 13.5 }}>
              {state === "connecting" ? "Connecting…" : state === "ringing" ? `Ringing ${dialLabel}…` : `🔴 Live with ${dialLabel} · ${clock(secs)}`}
            </span>
            <button className="btn ghost small" onClick={() => { const m = !muted; callRef.current?.mute(m); setMuted(m); }}>{muted ? "🔇 Unmute" : "🎙 Mute"}</button>
            <button className="btn small" style={{ background: "#a02020" }} onClick={() => callRef.current?.disconnect()}>⏹ Hang up</button>
          </>
        )}
        <span className="muted" style={{ fontSize: 12 }}>
          {mode === "browser"
            ? `uses this computer's mic & speakers · shows ${voice?.callerId || "the store number"} · recorded, transcribed and filed to this lead`
            : "store number shows as caller ID · recorded, transcribed and filed to this lead"}
        </span>
      </div>
      {err && <div className="banner error" style={{ marginTop: 8 }}>{err}</div>}
    </div>
  );
}
