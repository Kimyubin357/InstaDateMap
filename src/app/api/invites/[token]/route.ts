import { NextResponse } from "next/server";
import { AccessError, accessError, accountFromRequest } from "@/lib/auth";
import { tokenHash } from "@/lib/pin";
import { isInviteToken } from "@/lib/folders";
import { folderRpc, invitePreview, noStore, openFolder, requireAccount } from "@/lib/folders-server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Params = { params: Promise<{ token: string }> };

export async function GET(req: Request, { params }: Params) {
  try {
    const account = await accountFromRequest(req);
    return NextResponse.json(await invitePreview((await params).token, account?.userId ?? null), noStore);
  } catch (e) { return accessError(e); }
}

/** 초대 수락: 멤버로 참여하고 이 기기에서 그 폴더를 엽니다. 이미 멤버면 열기만 합니다. */
export async function POST(req: Request, { params }: Params) {
  try {
    const account = await requireAccount(req);
    const { token } = await params;
    if (!isInviteToken(token)) throw new AccessError("초대 링크가 올바르지 않아요.", 404);
    const joined = await folderRpc<{ board_id: string }>("dm_accept_invite", { p_user: account.userId, p_token_hash: tokenHash(token) }, "폴더에 참여하지 못했어요. 잠시 후 다시 시도해 주세요.");
    await openFolder(account, joined.board_id);
    return NextResponse.json({ current: joined.board_id }, noStore);
  } catch (e) { return accessError(e); }
}
