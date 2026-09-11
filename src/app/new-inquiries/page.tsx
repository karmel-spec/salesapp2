import { ActivityView } from "@/components/ActivityView";

/** New Inquiries — first-contact messages (webchat, main-line texts,
 * SalesCaptain leads, cold emails) where nobody at BLP has reached out yet.
 * The moment someone replies, later messages move to the responses inboxes. */
export default function NewInquiriesPage() {
  return <ActivityView inboxOnly scope="new" />;
}
