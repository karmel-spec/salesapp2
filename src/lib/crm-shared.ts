/** Types + pure helpers shared by server CRM code and client components. */

/** The CRM's contact card (lib/integration.js contactOf on the CRM side). */
export interface CrmCard {
  id?: number;
  display_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  emails?: string[];
  phone?: string | null;
  phones?: string[];
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
}

/** One line for the sheet's single address cell, from the CRM's split fields. */
export function crmFullAddress(card: CrmCard): string {
  return [card.address, card.city, [card.state, card.zip].filter(Boolean).join(" ")]
    .map((s) => String(s || "").trim())
    .filter(Boolean)
    .join(", ");
}
