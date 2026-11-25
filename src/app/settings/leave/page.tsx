import { redirect } from "next/navigation";
import { requirePageBoard } from "@/lib/access";
import { MapEntry } from "@/components/BoardProvider";
import { syncAccess } from "@/lib/sync-server";
export const dynamic = "force-dynamic";
export default async function LeavePage() {
  const board = await requirePageBoard("/settings/leave");
  if (!board.userId) redirect(`/login?next=${encodeURIComponent("/settings/leave")}`);
  return <MapEntry access={syncAccess(board)} />;
}
