import { ActivityView } from "@/components/ActivityView";

/** Customer Service — the sorting queue: every new inquiry that isn't Tuning
 * or Moving. From here a message is filed to a folder (📁), turned into a
 * lead by changing its status (→ Leads / BL Leads), or left as service.
 * Counts: Tuning + Moving + Customer Service = New Inquiries. */
export default function CustomerServicePage() {
  return <ActivityView inboxOnly scope="new" excludeFolders={["tuning", "moving"]} />;
}
