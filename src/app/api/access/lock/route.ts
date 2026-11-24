import { NextResponse } from "next/server";
import { accountFromRequest, SESSION_COOKIE, accessError, checkOrigin } from "@/lib/auth";
import { db } from "@/lib/db";
/** 로그아웃: 이 기기의 로그인 세션만 지웁니다(폴더가 없는 세션 포함). 카카오·구글 계정 로그아웃은 하지 않습니다. */
export async function POST(req: Request) {
  try {
    checkOrigin(req);
    const account = await accountFromRequest(req);
    if (account) {
      const { error } = await db().from("access_sessions").delete().eq("token_hash", account.sessionHash);
      if (error) throw new Error("로그아웃하지 못했어요. 다시 시도해 주세요.");
    }
    const res = NextResponse.json({ next: "/login" });
    res.cookies.delete(SESSION_COOKIE);
    return res;
  } catch (e) { return accessError(e); }
}
