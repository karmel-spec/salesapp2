import { Mailbox } from "@/components/Mailbox";
import { TeamBoard } from "@/components/TeamBoard";
import { BOARD_PEOPLE } from "@/lib/board";

/**
 * A team member's page: their email inbox, worked from the console (so anyone
 * can help), for people with a mailbox; the board focused on them otherwise
 * (shop staff have task boards but no console mailbox).
 */
export default async function BoardPersonPage({ params }: { params: Promise<{ person: string }> }) {
  const { person } = await params;
  const key = person.toLowerCase();
  const p = BOARD_PEOPLE.find((x) => x.key === key);
  if (p?.mailbox) return <Mailbox person={key} displayName={p.name} />;
  return <TeamBoard initialPerson={key} />;
}
