import { ActivityView } from "@/components/ActivityView";

/** Client Responses — new inquiries plus replies to the rest of the team.
 * Direct replies to Brigham's outreach live in /bl-inbox instead.
 * Deep link: ?tab=general */
export default function InboxPage() {
  return <ActivityView inboxOnly scope="others" />;
}
