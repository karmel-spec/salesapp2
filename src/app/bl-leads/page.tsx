import { LeadsView } from "@/components/LeadsView";

/** BL Leads — only the leads assigned to Brigham. */
export default function BrighamLeadsPage() {
  return <LeadsView scope="brigham" />;
}
