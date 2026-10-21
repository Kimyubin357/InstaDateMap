import AddForm from "./AddForm";
import { legacyRedirect, requirePageBoard } from "@/lib/access";
export const dynamic = "force-dynamic";
export default async function AddPage({ searchParams }: { searchParams: { t?: string; url?: string } }) {
  const next = `/add${searchParams.url ? `?url=${encodeURIComponent(searchParams.url)}` : ""}`;
  legacyRedirect(searchParams.t, next);
  await requirePageBoard(next);
  return <AddForm initialUrl={searchParams.url || ""} />;
}
