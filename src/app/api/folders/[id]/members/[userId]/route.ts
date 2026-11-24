import { NextResponse } from "next/server";
import { accessError } from "@/lib/auth";
import { currentFolder, folderId, folderRpc, noStore, requireAccount } from "@/lib/folders-server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 내보내기(방장) 또는 나가기(본인). 방장이 나가면 가장 먼저 참여한 멤버가 방장이 됩니다. */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string; userId: string }> }) {
  try {
    const account = await requireAccount(req);
    const { id, userId } = await params;
    await folderRpc("dm_remove_member", { p_actor: account.userId, p_board: folderId(id), p_member: folderId(userId) }, "멤버를 정리하지 못했어요. 잠시 후 다시 시도해 주세요.");
    return NextResponse.json({ current: await currentFolder(account.sessionHash) }, noStore);
  } catch (e) { return accessError(e); }
}
