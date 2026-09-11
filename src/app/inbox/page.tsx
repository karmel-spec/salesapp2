import { ActivityView } from "@/components/ActivityView";

/** New Client Responses — the inbound-replies inbox (Sales + General tabs),
 * split out of Activity as its own nav destination. Deep link: ?tab=general */
export default function InboxPage() {
  return <ActivityView inboxOnly />;
}
