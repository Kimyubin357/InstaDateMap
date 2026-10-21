import { MapEntry } from "@/components/BoardProvider";
import { legacyRedirect, requirePageBoard } from "@/lib/access";
import { syncAccess } from "@/lib/sync-server";
export const dynamic = "force-dynamic";
export default async function AddPage({ searchParams }: { searchParams: { t?: string; url?: string } }) {
  const next = `/add${searchParams.url ? `?url=${encodeURIComponent(searchParams.url)}` : ""}`;
  legacyRedirect(searchParams.t, next);
  const board = await requirePageBoard(next);
  return <MapEntry access={syncAccess(board)} />;
}
