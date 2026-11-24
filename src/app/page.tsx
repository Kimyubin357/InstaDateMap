import { MapEntry } from "@/components/BoardProvider";
import { pageRequest, requirePageBoard } from "@/lib/access";
import { accountFromRequest } from "@/lib/auth";
import { isUuid } from "@/lib/folders";
import { openFolder } from "@/lib/folders-server";
import { syncAccess } from "@/lib/sync-server";
export const dynamic = "force-dynamic";
export default async function Page({ searchParams: query }: { searchParams: Promise<{ t?: string; place?: string; folder?: string; saved?: string; view?: string; section?: string; collection?: string; organize?: string }> }) {
  const searchParams = await query;
  let next = searchParams.place ? `/?place=${encodeURIComponent(searchParams.place)}` : searchParams.saved ? `/?saved=${encodeURIComponent(searchParams.saved)}` : searchParams.view === "list" ? "/?view=list" : "/";
  const destination = new URL(next, "http://localhost");
  if (searchParams.view === "list") destination.searchParams.set("view", "list");
  if (searchParams.section === "collections") destination.searchParams.set("section", "collections");
  for (const key of ["collection", "organize"] as const) if (searchParams[key] && /^[0-9a-f-]{36}$/i.test(searchParams[key]!)) destination.searchParams.set(key, searchParams[key]!);
  next = destination.pathname + destination.search;
  // 다른 폴더의 알림을 눌러 들어오면 그 폴더를 먼저 엽니다(참여한 폴더일 때만, 실패하면 지금 폴더 그대로).
  if (searchParams.folder && isUuid(searchParams.folder)) {
    const account = await accountFromRequest(await pageRequest());
    if (account && account.boardId !== searchParams.folder) await openFolder(account, searchParams.folder).catch(() => undefined);
  }
  const board = await requirePageBoard(next);
  return <MapEntry access={syncAccess(board)} />;
}
