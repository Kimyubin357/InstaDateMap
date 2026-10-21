import { MapEntry } from "@/components/BoardProvider";
import { legacyRedirect, requirePageBoard } from "@/lib/access";
import { syncAccess } from "@/lib/sync-server";
export const dynamic = "force-dynamic";
export default async function Page({ searchParams }: { searchParams: { t?: string; place?: string; saved?: string; view?: string } }) {
  const next = searchParams.place ? `/?place=${encodeURIComponent(searchParams.place)}` : searchParams.saved ? `/?saved=${encodeURIComponent(searchParams.saved)}` : searchParams.view === "list" ? "/?view=list" : "/";
  legacyRedirect(searchParams.t, next);
  const board = await requirePageBoard(next);
  return <MapEntry access={syncAccess(board)} />;
}
