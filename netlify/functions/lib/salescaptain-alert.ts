/**
 * Parse a SalesCaptain notification email into the payload the console's
 * /api/salescaptain/inbound route expects. Three templates exist:
 *
 *  A  "You got a new incoming message!"  (texts to the main line; lands in karmel@)
 *     "<Name> sent a message to Brigham Larson Pianos at 8/31/2026, 10:49 AM and
 *      is currently waiting for a reply. Current wait time: 1 minutes <TEXT>
 *      8/31/2026, 10:49 AM Redirect to SalesCaptain …"
 *  B  "New message from <Name> <text>"
 *  C  "New webchat lead received…"  Name: … Phone: +1… Message: … View Lead …
 *
 * Only headers/text are read; nothing is sent anywhere from here.
 */

export interface ParsedAlert {
  senderName: string;
  senderPhone: string; // last 10 digits, or ""
  messageText: string;
  channel: "text" | "webchat" | "facebook" | "instagram" | "salescaptain";
  photo: boolean; // the alert mentions a photo/MMS but carries no image
  format: "A" | "B" | "C" | "unknown";
  /** When the customer actually sent it (Format A prints "at 8/7/2026, 11:51 AM"
   *  in shop time); the alert email itself arrives minutes later. */
  sentAt?: string;
}

/** "8/7/2026, 11:51 AM" in America/Denver → ISO UTC. */
export function denverToIso(stamp: string): string | undefined {
  const m = /(\d{1,2})\/(\d{1,2})\/(\d{4}),?\s+(\d{1,2}):(\d{2})\s*([AP]M)/i.exec(stamp);
  if (!m) return undefined;
  let h = Number(m[4]) % 12;
  if (/pm/i.test(m[6])) h += 12;
  const guess = Date.UTC(Number(m[3]), Number(m[1]) - 1, Number(m[2]), h, Number(m[5]));
  // Find Denver's offset at that instant and shift the naive UTC guess by it.
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", timeZoneName: "shortOffset" }).formatToParts(new Date(guess));
  const off = parts.find((p) => p.type === "timeZoneName")?.value || "GMT-6";
  const hrs = Number((/GMT([+-]\d+)/.exec(off) || [])[1] || -6);
  return new Date(guess - hrs * 3600_000).toISOString();
}

const flat = (s: string) => s.replace(/\s+/g, " ").trim();
const last10 = (s: string) => {
  const d = s.replace(/\D/g, "");
  return d.length >= 10 ? d.slice(-10) : "";
};
const BOILER = /\s*(Redirect to SalesCaptain|View Lead in Dashboard|View Lead\b|This message was sent|Download the SalesCaptain|Powered by Salescaptain).*$/i;

export function parseSalesCaptainAlert(subject: string, body: string): ParsedAlert | null {
  // The banner appears in the subject and again at the top of the body.
  const full = flat(`${subject}\n${body}`).replace(/You got a new incoming message!?/gi, " ").replace(/\s+/g, " ").trim();
  const channel = (): ParsedAlert["channel"] =>
    /webchat/i.test(full) ? "webchat" : /facebook|messenger/i.test(full) ? "facebook" : /instagram/i.test(full) ? "instagram" : /incoming message|sent a message/i.test(full) ? "text" : "salescaptain";

  // C — webchat lead with labeled fields
  const mc = /\bName:\s*(.+?)\s+Phone:\s*(\+?[\d()\s.-]{7,20})\s+Message:\s*(.*?)(?:\s*View Lead\b|\s*This message was sent\b|$)/i.exec(full);
  if (mc) {
    const text = mc[3].replace(BOILER, "").trim();
    return { senderName: mc[1].trim(), senderPhone: last10(mc[2]), messageText: text, channel: "webchat", photo: /photo|image|\bMMS\b/i.test(text) && text.length < 40, format: "C" };
  }
  // A — main-line text alert: the customer's text sits between "Current wait
  // time: N minutes" and the repeated "<date>, <time> Redirect to SalesCaptain".
  const ma = /^(.+?) sent a message to Brigham Larson Pianos at (\d{1,2}\/\d{1,2}\/\d{4}, \d{1,2}:\d{2} [AP]M) and is currently waiting for a reply\.?\s*(?:Current wait time:\s*\d+\s*minutes?\s*)?(.*)$/i.exec(full);
  if (ma) {
    let text = ma[3];
    const when = ma[2];
    const cut = text.indexOf(when);
    if (cut >= 0) text = text.slice(0, cut);
    text = text.replace(BOILER, "").trim();
    const nameRaw = ma[1].trim();
    const phone = last10(nameRaw); // some alerts show a raw number instead of a name
    // "🏞️ Photo", "🌎️ Photo", "Photo (MMS)", "Image" — a marker, not the image.
    const marker = text.replace(/^[^\p{L}\p{N}]+/u, "").trim();
    const photo = /^(photo|image|picture|mms)\b/i.test(marker) && marker.length < 30;
    return { senderName: phone ? "" : nameRaw, senderPhone: phone, messageText: text, channel: channel(), photo, format: "A", sentAt: denverToIso(when) };
  }
  // B — "New message from <Name> <text>"
  const mb = /New message from\s+(.+?)(?:\n|\s{2,}|:\s)(.+)/s.exec(`${subject}\n${body}`);
  if (mb) {
    const nm = flat(mb[1]);
    // The body usually repeats the subject line; drop that prefix.
    const text = flat(mb[2]).replace(new RegExp(`^New message from\\s+${nm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:?\\s*`, "i"), "").replace(BOILER, "").trim();
    return { senderName: nm, senderPhone: "", messageText: text, channel: channel(), photo: /photo|image|\bMMS\b/i.test(text) && text.length < 40, format: "B" };
  }
  return null;
}

/** Strip an HTML body down to text (SalesCaptain alerts are HTML-only). */
export function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>|<\/p>|<\/div>|<\/li>|<\/tr>|<\/h[1-6]>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/\s+/g, " ")
    .trim();
}
