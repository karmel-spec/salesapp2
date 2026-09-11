import { LeadsView } from "@/components/LeadsView";

/** Leads — everyone's leads except Brigham's (his live in /bl-leads).
 * Dashboard tiles pass ?all=1 to see the whole company pipeline here. */
export default function LeadsPage() {
  return <LeadsView scope="others" />;
}
