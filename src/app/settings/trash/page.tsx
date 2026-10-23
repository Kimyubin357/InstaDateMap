import { requirePageBoard } from "@/lib/access";
import { MapEntry } from "@/components/BoardProvider";
import { syncAccess } from "@/lib/sync-server";
export const dynamic = "force-dynamic";
export default async function TrashPage() {
  const board = await requirePageBoard("/settings/trash");
  return <MapEntry access={syncAccess(board)} />;
}
