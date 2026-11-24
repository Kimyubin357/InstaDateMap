import { NextResponse } from "next/server";
import { accessError } from "@/lib/auth";
import { folderDetail, folderId, folderRpc, noStore, requireAccount } from "@/lib/folders-server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 방장 넘기기 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const account = await requireAccount(req);
    const id = folderId((await params).id);
    const body = await req.json().catch(() => null);
    await folderRpc("dm_transfer_owner", { p_actor: account.userId, p_board: id, p_member: folderId(String(body?.userId ?? "")) }, "방장을 넘기지 못했어요. 잠시 후 다시 시도해 주세요.");
    return NextResponse.json(await folderDetail(account, id), noStore);
  } catch (e) { return accessError(e); }
}
