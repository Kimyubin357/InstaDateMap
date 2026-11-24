import { redirect } from "next/navigation";
import { requirePageBoard } from "@/lib/access";
import { MapEntry } from "@/components/BoardProvider";
import { syncAccess } from "@/lib/sync-server";
export const dynamic = "force-dynamic";
export default async function ProfilePage() {
  const board = await requirePageBoard("/settings/profile");
  if (!board.userId) redirect(`/login?next=${encodeURIComponent("/settings/profile")}`);
  return <MapEntry access={syncAccess(board)} />;
}
