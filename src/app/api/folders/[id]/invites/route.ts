import { NextResponse } from "next/server";
import { accessError } from "@/lib/auth";
import { newToken, tokenHash } from "@/lib/pin";
import { folderId, folderRpc, noStore, requireAccount } from "@/lib/folders-server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };

/** 초대 링크 만들기(방장). 원문 토큰은 이 응답에만 있고 DB에는 해시만 남습니다. */
export async function POST(req: Request, { params }: Params) {
  try {
    const account = await requireAccount(req);
    const token = newToken();
    const result = await folderRpc<{ expires_at: string }>("dm_create_invite", { p_actor: account.userId, p_board: folderId((await params).id), p_token_hash: tokenHash(token) }, "초대 링크를 만들지 못했어요. 잠시 후 다시 시도해 주세요.");
    return NextResponse.json({ url: new URL(`/invite/${token}`, req.url).toString(), expires_at: result.expires_at }, noStore);
  } catch (e) { return accessError(e); }
}

/** 지금까지 만든 초대 링크를 모두 끊습니다(방장). */
export async function DELETE(req: Request, { params }: Params) {
  try {
    const account = await requireAccount(req);
    const revoked = await folderRpc<number>("dm_revoke_invites", { p_actor: account.userId, p_board: folderId((await params).id) }, "초대 링크를 끊지 못했어요. 잠시 후 다시 시도해 주세요.");
    return NextResponse.json({ revoked }, noStore);
  } catch (e) { return accessError(e); }
}
