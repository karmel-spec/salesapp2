import { redirect } from "next/navigation";

/** Reports now lives as a tab of the combined Dashboard & Reports page —
 * this keeps old /reports bookmarks and deep links working. */
export default function ReportsRedirect() {
  redirect("/?tab=reports");
}
