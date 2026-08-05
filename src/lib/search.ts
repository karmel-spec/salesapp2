/**
 * Forgiving search matching: case-, punctuation-, accent-, and word-order-
 * blind. "andersen elaine", "O'Brien" vs "obrien", and "elaine gmail" all
 * match the leads a human would expect. Phone-style digit runs are matched
 * digits-to-digits so any formatting works.
 */
export function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip accents: José → jose
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Every word of the query must appear somewhere in the haystack. */
export function looseIncludes(haystack: string, query: string): boolean {
  const tokens = normalizeText(query).split(" ").filter(Boolean);
  if (!tokens.length) return true;
  const hay = normalizeText(haystack);
  const hayDigits = haystack.replace(/\D/g, "");
  return tokens.every((t) => {
    if (hay.includes(t)) return true;
    // A long digit-run token (an unformatted phone) matches the stored
    // number even when the sheet has it formatted with spaces/dashes.
    return /^\d{4,}$/.test(t) && hayDigits.includes(t);
  });
}
