import { NextResponse } from "next/server";
import { AccessError, accessError } from "@/lib/auth";
import { folderInput } from "@/lib/folders";
import { currentFolder, folderDetail, folderId, folderRpc, noStore, requireAccount } from "@/lib/folders-server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Params) {
  try {
    const account = await requireAccount(req);
    return NextResponse.json(await folderDetail(account, folderId((await params).id)), noStore);
  } catch (e) { return accessError(e); }
}

/** 이름·표지 수정(방장) */
export async function PATCH(req: Request, { params }: Params) {
  try {
    const account = await requireAccount(req);
    const id = folderId((await params).id);
    const input = folderInput(await req.json().catch(() => null));
    if (typeof input === "string") throw new AccessError(input);
    await folderRpc("dm_update_folder", { p_user: account.userId, p_board: id, p_name: input.name, p_color: input.color, p_icon: input.icon }, "폴더를 바꾸지 못했어요. 잠시 후 다시 시도해 주세요.");
    return NextResponse.json(await folderDetail(account, id), noStore);
  } catch (e) { return accessError(e); }
}

/** 폴더 삭제(방장). 모든 멤버에게서 장소·메모·모음이 사라집니다. */
export async function DELETE(req: Request, { params }: Params) {
  try {
    const account = await requireAccount(req);
    await folderRpc("dm_delete_folder", { p_user: account.userId, p_board: folderId((await params).id) }, "폴더를 삭제하지 못했어요. 잠시 후 다시 시도해 주세요.");
    return NextResponse.json({ current: await currentFolder(account.sessionHash) }, noStore);
  } catch (e) { return accessError(e); }
}
