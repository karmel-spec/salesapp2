"use client";

import { useEffect, useMemo, useRef } from "react";
import type { Lead, TimelineEvent } from "@/lib/leads";
import { Linkify } from "@/components/ui";

/**
 * The client↔BLP conversation as chat bubbles — texts and emails only
 * (calls/meetings render as centered system lines). Oldest first, opens
 * scrolled to the newest message. Used by the lead page's Conversation
 * card and the Activity inbox popup.
 */

const THREAD_KINDS = new Set(["inbound", "sms_out", "email_out", "call", "call_attempt", "meeting", "visit"]);

export function Thread({ lead, maxHeight }: { lead: Lead; maxHeight?: number }) {
  const threadRef = useRef<HTMLDivElement>(null);

  const thread = useMemo(
    () =>
      lead.timeline
        .filter((e: TimelineEvent) => THREAD_KINDS.has(e.kind))
        .slice()
        .sort((a, b) => {
          const t = (s: string) => {
            const d = new Date(s);
            return isNaN(d.getTime()) ? 0 : d.getTime();
          };
          return t(a.at) - t(b.at);
        }),
    [lead]
  );

  // Start at the newest message (scrolls the pane, never the page).
  useEffect(() => {
    const t = threadRef.current;
    if (t) t.scrollTop = t.scrollHeight;
  }, [lead.id, thread.length]);

  return (
    <div className="thread" ref={threadRef} style={maxHeight ? { maxHeight } : undefined}>
      {thread.length === 0 && <div className="muted">No messages logged with this client yet.</div>}
      {thread.map((e, i) => {
        const d = new Date(e.at);
        const valid = !isNaN(d.getTime());
        const stamp = valid
          ? d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) +
            " · " +
            d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
          : e.at;
        if (e.kind === "call" || e.kind === "call_attempt" || e.kind === "meeting" || e.kind === "visit") {
          const audio = e.text.match(/🎧 Audio: (https?:\/\/\S+)/)?.[1];
          const sysText = e.text.replace(/\n?🎧 Audio: https?:\/\/\S+/g, "");
          return (
            <div key={i} className="thread-sys">
              📞 {stamp} · {e.who} — {sysText.slice(0, 200)}
              {audio && (
                <audio controls preload="none" src={audio} className="thread-audio">
                  <a href={audio}>🎧 Listen</a>
                </audio>
              )}
            </div>
          );
        }
        const fromClient = e.kind === "inbound";
        const channel = e.kind === "email_out" || /email/i.test(e.text.slice(0, 30)) ? "✉️" : "📱";
        // "📷 Photo: <url>" lines (attachments) render as inline images.
        const photos = [...e.text.matchAll(/📷 Photo: (https?:\/\/\S+)/g)].map((m) => m[1]);
        const textSansPhotos = e.text.replace(/\n?📷 Photo: https?:\/\/\S+/g, "").trimEnd();
        return (
          <div key={i} className={`bubble-row ${fromClient ? "client" : "blp"}`}>
            <div className="bubble">
              <div className="bubble-meta">
                {fromClient ? `${channel} ${lead.name.split(" ")[0]}` : `${channel} ${e.who} (BLP)`} · {stamp}
                {e.kind === "email_out" && e.openedAt && (
                  <span className="opened-chip" title={`Customer opened this email ${new Date(e.openedAt).toLocaleString()}`}>
                    👁 opened
                  </span>
                )}
              </div>
              <Linkify text={textSansPhotos} />
              {photos.map((url) => (
                <a key={url} href={url} target="_blank" rel="noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt="attached photo" className="bubble-photo" />
                </a>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
