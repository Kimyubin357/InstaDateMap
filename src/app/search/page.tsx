import { MapEntry } from "@/components/BoardProvider";
import { requirePageBoard } from "@/lib/access";
import { syncAccess } from "@/lib/sync-server";
export const dynamic = "force-dynamic";
export default async function SearchPage({ searchParams }: { searchParams: { q?: string } }) {
  const next = `/search${searchParams.q ? `?q=${encodeURIComponent(searchParams.q.slice(0, 100))}` : ""}`;
  const board = await requirePageBoard(next);
  return <MapEntry access={syncAccess(board)} />;
}
