import { NextResponse } from "next/server";
import { AccessError, accessError } from "@/lib/auth";
import { folderInput } from "@/lib/folders";
import { folderRpc, listFolders, noStore, openFolder, requireAccount } from "@/lib/folders-server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 내 폴더 목록과 이 기기가 보고 있는 폴더 */
export async function GET(req: Request) {
  try {
    const account = await requireAccount(req);
    return NextResponse.json({ folders: await listFolders(account.userId), current: account.boardId }, noStore);
  } catch (e) { return accessError(e); }
}

/** 새 방을 만들고(만든 사람이 방장) 이 기기에서 바로 엽니다. 방은 이름과 색만 받고, 쓰지 않는 boards.icon은 기본값으로 둡니다. */
export async function POST(req: Request) {
  try {
    const account = await requireAccount(req);
    const input = folderInput(await req.json().catch(() => null));
    if (typeof input === "string") throw new AccessError(input);
    const created = await folderRpc<{ board_id: string }>("dm_create_folder", { p_user: account.userId, p_name: input.name, p_color: input.color, p_icon: "heart" }, "방을 만들지 못했어요. 잠시 후 다시 시도해 주세요.");
    await openFolder(account, created.board_id);
    return NextResponse.json({ id: created.board_id, current: created.board_id }, noStore);
  } catch (e) { return accessError(e); }
}
