import { ActivityView } from "@/components/ActivityView";

/** BL Client Responses — ONLY customer replies that directly answer a text,
 * email, or call Brigham sent (see lib/inbox-split.ts for the rule). */
export default function BrighamInboxPage() {
  return <ActivityView inboxOnly scope="brigham" />;
}
