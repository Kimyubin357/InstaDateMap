import { redirect } from "next/navigation";
import { accountFromRequest, boardFromRequest } from "@/lib/auth";
import { pageRequest } from "@/lib/access";
import { MapEntry } from "@/components/BoardProvider";
import { syncAccess } from "@/lib/sync-server";
import FoldersPanel from "./FoldersPanel";
export const dynamic = "force-dynamic";
/** 열린 폴더가 있으면 지도 셸 안에서, 폴더가 0개면 지도 없이 폴더 화면만 보여줍니다. */
export default async function FoldersPage() {
  const request = await pageRequest();
  const account = await accountFromRequest(request);
  if (!account) redirect(`/login?next=${encodeURIComponent("/folders")}`);
  const board = await boardFromRequest(request);
  return board ? <MapEntry access={syncAccess(board)} /> : <FoldersPanel standalone />;
}
