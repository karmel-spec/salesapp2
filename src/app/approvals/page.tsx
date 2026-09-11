import { redirect } from "next/navigation";

/** The standalone approval queue was retired — Arnold's drafts are approved
 * from each lead's page so the rep sees the lead's context first. Old
 * bookmarks land on the Leads tab filtered to leads with pending drafts. */
export default function ApprovalsRedirect() {
  redirect("/leads?drafts=1");
}
