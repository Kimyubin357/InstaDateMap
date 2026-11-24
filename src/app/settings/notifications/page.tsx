import { requirePageBoard } from "@/lib/access";
import { MapEntry } from "@/components/BoardProvider";
import { syncAccess } from "@/lib/sync-server";
export const dynamic = "force-dynamic";
export default async function NotificationsPage() {
  const board = await requirePageBoard("/settings/notifications");
  return <MapEntry access={syncAccess(board)} />;
}
