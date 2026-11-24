import { NextResponse } from "next/server";
import { accessError, SESSION_COOKIE } from "@/lib/auth";
import { folderRpc, requireAccount } from "@/lib/folders-server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 회원 탈퇴. 혼자 쓰던 폴더는 삭제하고, 함께 쓰던 폴더는 나갑니다(방장이면 다음 멤버에게 넘김).
 * 계정·로그인 연결·약관 동의 이력·모든 기기의 로그인 세션과 알림 구독이 지워집니다(016_account_delete_pin_cleanup.sql).
 * 카카오·구글 쪽 앱 연결은 공급자 토큰을 보관하지 않아 여기서 끊지 않습니다. 다시 로그인하면 새 계정으로 시작합니다.
 */
export async function DELETE(req: Request) {
  try {
    const account = await requireAccount(req);
    const result = await folderRpc<{ deleted_folders: number; left_folders: number }>("dm_delete_account", { p_user: account.userId }, "탈퇴하지 못했어요. 잠시 후 다시 시도해 주세요.");
    const res = NextResponse.json({ next: "/login", ...result }, { headers: { "Cache-Control": "no-store" } });
    res.cookies.delete(SESSION_COOKIE);
    return res;
  } catch (e) { return accessError(e); }
}
