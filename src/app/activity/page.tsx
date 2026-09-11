import { redirect } from "next/navigation";

/** The activity log now lives as a tab of the Dashboard — keeps old
 * /activity links (and ?filter= deep links) working. */
export default async function ActivityRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const filter = typeof sp.filter === "string" ? `&filter=${encodeURIComponent(sp.filter)}` : "";
  redirect(`/?tab=activity${filter}`);
}
