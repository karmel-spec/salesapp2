import { BOARD_PEOPLE } from "./board";
import { imapConfigured } from "./imapmail";

export type MailProvider =
  | { kind: "gmail"; user: string; name: string } // Workspace mailbox via domain-wide delegation
  | { kind: "imap"; user: string; name: string } // personal Gmail via app password
  | { error: string; status: number };

/** Resolve a sidebar person key to the way we can read/write their mailbox. */
export function mailboxFor(key: string): MailProvider {
  const p = BOARD_PEOPLE.find((x) => x.key === key.toLowerCase());
  if (!p || !p.mailbox) return { error: "No mailbox for that person", status: 404 };
  if (p.personalGmail) {
    if (!imapConfigured(p.mailbox)) {
      return {
        error: `${p.name} (${p.mailbox}) isn't connected yet. It's a personal Gmail, so it connects with a Google App Password: turn on 2-Step Verification for that account, create an App Password, and add it in Netlify.`,
        status: 409,
      };
    }
    return { kind: "imap", user: p.mailbox, name: p.name };
  }
  return { kind: "gmail", user: p.mailbox, name: p.name };
}
