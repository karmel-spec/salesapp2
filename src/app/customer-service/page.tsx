import { LeadsView } from "@/components/LeadsView";

/** Customer Service — contacts in the Support status (walk-up questions,
 * tuning, moving, "do you buy pianos?"). Kept apart from the lead tabs so
 * service traffic never inflates the sales pipeline. */
export default function CustomerServicePage() {
  return <LeadsView scope="support" />;
}
