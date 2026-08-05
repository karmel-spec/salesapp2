/**
 * Where an inbound message came from (text, webchat, Instagram, …).
 * New events are tagged at ingestion via TimelineEvent.source; older events
 * fall back to sniffing the message text so history still gets an icon.
 */
export const SOURCE_META: Record<string, { icon: string; label: string }> = {
  text: { icon: "📱", label: "Text message" },
  phone: { icon: "📞", label: "Phone call" },
  email: { icon: "✉️", label: "Email" },
  webchat: { icon: "💬", label: "Website chat" },
  facebook: { icon: "📘", label: "Facebook Messenger" },
  instagram: { icon: "📸", label: "Instagram DM" },
  salescaptain: { icon: "🗨️", label: "SalesCaptain (text/webchat)" },
};

export function messageSource(ev: { source?: string; kind?: string; text?: string }): string {
  if (ev.source && SOURCE_META[ev.source]) return ev.source;
  const t = ev.text || "";
  if (/instagram|\binsta\b|\big dm\b/i.test(t)) return "instagram";
  if (/facebook|messenger/i.test(t)) return "facebook";
  if (/web ?chat/i.test(t)) return "webchat";
  if (/salescaptain/i.test(t)) return "salescaptain";
  if (/customer emailed|emailed back|by email/i.test(t.slice(0, 60))) return "email";
  if (/customer texted|texted back|\bMMS\b|\bSMS\b/i.test(t.slice(0, 60))) return "text";
  if (ev.kind === "call" || ev.kind === "call_attempt" || /^📞|phone call|call recording/i.test(t)) return "phone";
  return "";
}
