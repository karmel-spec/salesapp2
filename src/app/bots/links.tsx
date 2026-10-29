"use client";

import { useState } from "react";

type Bot = { slug: string; name: string; token: string; link: string };

export default function BotLinks({ bots, base }: { bots: Bot[]; base: string }) {
  const [copied, setCopied] = useState("");
  const [showKeys, setShowKeys] = useState(false);
  async function copy(text: string, id: string) {
    try { await navigator.clipboard.writeText(text); setCopied(id); setTimeout(() => setCopied(""), 1500); } catch { /* fall back to manual select */ }
  }
  return (
    <div style={{ maxWidth: 860, margin: "0 auto", padding: "24px 16px" }}>
      <h1 style={{ marginBottom: 4 }}>Bot access</h1>
      <p className="sub" style={{ marginBottom: 18 }}>
        Each Grok Bot has its own sign-in link. Paste the link into the bot&apos;s browser once: it signs in for 90 days with no form,
        no Google and nothing to type, and everything it does is attributed to it by name. The same token works as an
        <code> x-blp-key</code> header on every API route for bots that don&apos;t need a screen.
      </p>
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ textAlign: "left", background: "rgba(0,0,0,0.04)" }}>
              <th style={{ padding: "10px 14px" }}>Bot</th>
              <th style={{ padding: "10px 14px" }}>Sign-in link</th>
              <th style={{ padding: "10px 14px", width: 120 }}></th>
            </tr>
          </thead>
          <tbody>
            {bots.map((b) => (
              <tr key={b.slug} style={{ borderTop: "1px solid rgba(0,0,0,0.08)" }}>
                <td style={{ padding: "10px 14px", fontWeight: 600, whiteSpace: "nowrap" }}>{b.name}</td>
                <td style={{ padding: "10px 14px", fontFamily: "ui-monospace, monospace", fontSize: 12, wordBreak: "break-all" }}>
                  {showKeys ? b.link : `${base}/api/auth/bot?token=${b.slug}.••••••••`}
                </td>
                <td style={{ padding: "10px 14px", whiteSpace: "nowrap" }}>
                  <button className="btn" type="button" onClick={() => copy(b.link, `l-${b.slug}`)}>{copied === `l-${b.slug}` ? "Copied ✓" : "Copy link"}</button>{" "}
                  <button className="btn" type="button" onClick={() => copy(b.token, `k-${b.slug}`)} title="API key for x-blp-key">{copied === `k-${b.slug}` ? "Copied ✓" : "Key"}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ marginTop: 12, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <button className="btn" type="button" onClick={() => setShowKeys((v) => !v)}>{showKeys ? "Hide full links" : "Show full links"}</button>
        <span className="sub">Add <code>&amp;next=/leads/&lt;id&gt;</code> to a link to land on a specific lead.</span>
      </div>
      <div className="card" style={{ marginTop: 18 }}>
        <h3 style={{ marginTop: 0 }}>Revoking</h3>
        <p className="sub" style={{ margin: 0 }}>
          Remove a bot&apos;s name from <code>BLP_BOTS</code> in Netlify to cut off that one bot; change <code>BLP_BOT_SECRET</code> to sign every bot out at once and issue new links.
        </p>
      </div>
    </div>
  );
}
