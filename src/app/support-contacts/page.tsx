import { LeadsView } from "@/components/LeadsView";

/** All contacts in the Support status as a lead-style list (the former
 * Customer Service tab). Not in the nav; linked from Customer Service. */
export default function SupportContactsPage() {
  return <LeadsView scope="support" />;
}
