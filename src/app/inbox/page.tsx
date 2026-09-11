import { ActivityView } from "@/components/ActivityView";

/** Client Responses — replies to the rest of the team's outreach. Replies to
 * Brigham live in /bl-inbox; unanswered first contacts in /new-inquiries.
 * Deep link: ?tab=general */
export default function InboxPage() {
  return <ActivityView inboxOnly scope="others" />;
}
