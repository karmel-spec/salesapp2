"use client";

import { useState } from "react";

export default function LoginPage() {
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ passcode }),
    });
    if (res.ok) {
      window.location.href = "/";
    } else {
      setError("That passcode didn't match.");
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <div className="login-card">
        <h1>
          Brigham Larson <em style={{ color: "var(--crimson)", fontStyle: "normal" }}>Pianos</em>
        </h1>
        <div className="sub">Sales Console — team access</div>
        <form onSubmit={submit}>
          {error && <div className="banner bad">⚠ {error}</div>}
          <input
            type="password"
            placeholder="Team passcode"
            value={passcode}
            onChange={(e) => setPasscode(e.target.value)}
            autoFocus
          />
          <button className="btn" disabled={busy}>
            {busy ? "Checking…" : "Enter the shop"}
          </button>
        </form>
      </div>
    </div>
  );
}
