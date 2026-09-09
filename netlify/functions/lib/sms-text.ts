/**
 * Make an outbound SMS body carrier-safe.
 *
 * Since the weekend of Sep 6 2026 the team's texts arrive with emoji and
 * typographic punctuation garbled ("🛠" → "üõ†", "—" → ",Äî", "→" → ",Üí"):
 * the delivery route hands the UTF-8 bytes of anything outside Latin-1 to
 * the phone as 8-bit data, which iPhones render as Mac Roman. Plain
 * letters — accented ones included — arrive intact. So every sender runs
 * its body through here: typographic marks become their ASCII equivalent,
 * emoji and other symbols are dropped, letters and digits are left alone.
 */
const MAP: Array<[RegExp, string]> = [
  [/[‐-―−]/g, "-"],            // hyphens, en/em dash, minus
  [/[‘’‚‛′]/g, "'"], // curly single quotes, prime
  [/[“”„‟″]/g, '"'], // curly double quotes
  [/…/g, "..."],
  [/[→⇒➜➡]/g, "->"],      // → ⇒ ➜ ➡
  [/[←⇐]/g, "<-"],                  // ← ⇐
  [/[↔⇔]/g, "<->"],                 // ↔ ⇔
  [/[·•‣◦⁃]/g, "-"], // middle dot, bullets
  [/[✓✔✅]/g, "OK"],            // ✓ ✔ ✅
  [/[✗✘❌❎]/g, "X"],       // ✗ ✘ ❌ ❎
  [/[✖×]/g, "x"],                   // ✖ ×
  [/⚠️?/g, "!"],                    // ⚠
  [/[  -   　]/g, " "],  // nbsp + typographic spaces
  [/[​-‍⁠︎️]/g, ""], // zero-width, variation selectors
];

export function smsSafe(text: string): string {
  let s = String(text ?? "").normalize("NFC");
  for (const [re, to] of MAP) s = s.replace(re, to);
  // everything pictographic or symbolic that is left (emoji, dingbats, box
  // drawing, currency other than $…) goes; letters in any script stay
  s = s.replace(/\p{Extended_Pictographic}|\p{Emoji_Modifier}|\p{Regional_Indicator}/gu, "");
  s = s.replace(/[\p{So}\p{Sk}]/gu, "");
  // tidy the gaps the removals leave: "🛠 Clock" → "Clock", "( 8:02" → "(8:02"
  s = s.replace(/[ \t]{2,}/g, " ").replace(/\( /g, "(").replace(/ \)/g, ")")
    .replace(/(\S) ([.,;:])(?=\s|$)/g, "$1$2")   // "Pianos 🎹." → "Pianos."
    .replace(/^[ \t]+|[ \t]+$/gm, "").replace(/\n{3,}/g, "\n\n");
  return s.trim();
}
