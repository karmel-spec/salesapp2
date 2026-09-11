import { TeamBoard } from "@/components/TeamBoard";

/** The board opened on one person (the sidebar's per-person entries). */
export default async function BoardPersonPage({ params }: { params: Promise<{ person: string }> }) {
  const { person } = await params;
  return <TeamBoard initialPerson={person.toLowerCase()} />;
}
