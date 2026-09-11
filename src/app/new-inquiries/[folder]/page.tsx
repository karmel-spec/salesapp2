import { notFound } from "next/navigation";
import { ActivityView } from "@/components/ActivityView";

/** A New Inquiries folder as its own sidebar page: /new-inquiries/tuning,
 * /new-inquiries/moving. The folder name is the slug, capitalized. */
export default async function NewInquiriesFolderPage({ params }: { params: Promise<{ folder: string }> }) {
  const { folder } = await params;
  const slug = decodeURIComponent(folder || "").trim();
  if (!/^[a-z][a-z0-9 _-]{0,30}$/i.test(slug)) notFound();
  const name = slug.charAt(0).toUpperCase() + slug.slice(1).toLowerCase();
  return <ActivityView inboxOnly scope="new" folder={name} />;
}
