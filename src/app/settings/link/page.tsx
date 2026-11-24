import { redirect } from "next/navigation";
import { requirePageBoard } from "@/lib/access";
import { MapEntry } from "@/components/BoardProvider";
import { syncAccess } from "@/lib/sync-server";
export const dynamic = "force-dynamic";
export default async function LinkPage() {
  const board = await requirePageBoard("/settings/link");
  if (!board.userId) redirect(`/login?next=${encodeURIComponent("/settings/link")}`);
  return <MapEntry access={syncAccess(board)} />;
}
