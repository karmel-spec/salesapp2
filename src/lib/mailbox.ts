import { BOARD_PEOPLE } from "./board";

/** Resolve a sidebar person key to a mailbox the service account can act as. */
export function mailboxFor(key: string): { user: string; name: string } | { error: string; status: number } {
  const p = BOARD_PEOPLE.find((x) => x.key === key.toLowerCase());
  if (!p || !p.mailbox) return { error: "No mailbox for that person", status: 404 };
  if (p.personalGmail) {
    return { error: `${p.name} is a personal Gmail account — it needs a one-time "Connect mailbox" sign-in before it can be worked here.`, status: 409 };
  }
  return { user: p.mailbox, name: p.name };
}
