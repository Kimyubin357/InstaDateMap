import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { db } from "./db";
import { accountFromRequest, boardFromRequest, safeNext, SESSION_COOKIE } from "./auth";
import { newToken, tokenHash } from "./token";
import { consentPath, termsPending } from "./terms-server";

export const sessionExpiry = (remember: boolean) => new Date(Date.now() + (remember ? 90 * 86400 : 12 * 3600) * 1000).toISOString();
/** 계정 로그인 세션을 만듭니다. 폴더가 없으면 boardId는 null입니다. */
export async function createSession(boardId: string | null, version: number, remember: boolean, account: { userId: string; memberName: string | null }) {
  const token = newToken();
  const { error } = await db().from("access_sessions").insert({ token_hash: tokenHash(token), board_id: boardId, purpose: "member",
    auth_version: version, remember, expires_at: sessionExpiry(remember), user_id: account.userId, member_name: account.memberName });
  if (error) throw new Error("이 기기에 입장 상태를 저장하지 못했어요.");
  return token;
}
export function setSessionCookie(response: NextResponse, token: string, remember: boolean) {
  response.cookies.set(SESSION_COOKIE, token, { httpOnly: true, secure: process.env.NODE_ENV === "production",
    sameSite: "lax", path: "/", ...(remember ? { maxAge: 90 * 86400 } : {}) });
  return response;
}
export async function pageRequest() {
  return new Request("http://localhost/", { headers: { cookie: (await cookies()).toString() } });
}
export async function requirePageBoard(next = "/") {
  const request = await pageRequest();
  const board = await boardFromRequest(request);
  if (!board) {
    // 로그인했지만 열 폴더가 없으면(0개) 폴더 화면에서 새로 만들거나 초대를 받습니다.
    if (await accountFromRequest(request)) redirect("/folders");
    redirect(`/login?next=${encodeURIComponent(safeNext(next))}`);
  }
  // 약관 동의 전이면 동의 화면부터(동의 화면을 건너뛰고 주소로 들어와도 막습니다).
  if (await termsPending(board.userId)) redirect(consentPath(safeNext(next)));
  return board;
}
