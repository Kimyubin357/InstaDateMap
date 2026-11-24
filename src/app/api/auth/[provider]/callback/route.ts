import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { AccessError, cookieValue, SESSION_COOKIE } from "@/lib/auth";
import { tokenHash } from "@/lib/pin";
import { consentPath, termsPending } from "@/lib/terms-server";
import { createSession, setSessionCookie } from "@/lib/access";
import { callbackUrl, exchangeProfile, isProvider, OAUTH_COOKIE, providerConfig, readOAuthCookie } from "@/lib/oauth";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** board_id가 null이면 폴더를 모두 지운 계정입니다. 지도 대신 폴더 화면으로 갑니다. */
interface LoginResult { user_id: string; board_id: string | null; member_name: string | null; auth_version: number; created: boolean; name_confirmed?: boolean }

/** 공급자에서 돌아온 뒤: state 확인 → 사용자 정보 → 계정·내 장소 → 90일 로그인 세션. */
export async function GET(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const url = new URL(req.url);
  let next = "/";
  const finish = (response: NextResponse) => {
    response.cookies.set(OAUTH_COOKIE, "", { path: "/api/auth", maxAge: 0 });
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  };
  const back = (error: string) => finish(NextResponse.redirect(new URL(`/login?error=${error}&next=${encodeURIComponent(next)}`, req.url)));
  if (!isProvider(provider)) return back("unavailable");
  try {
    ({ next } = readOAuthCookie(cookieValue(req, OAUTH_COOKIE), provider, url.searchParams.get("state")));
  } catch { return back("expired"); }
  // 사용자가 동의 화면에서 취소한 경우
  if (url.searchParams.get("error")) return back(url.searchParams.get("error") === "access_denied" ? "cancelled" : "failed");
  const code = url.searchParams.get("code");
  const config = providerConfig(provider);
  if (!config) { console.error(`OAuth ${provider} is not configured.`); return back("unavailable"); }
  if (!code || code.length > 2048) return back("failed");
  try {
    const profile = await exchangeProfile(provider, config, callbackUrl(url.origin, provider), code);
    const { data, error } = await db().rpc("dm_login", { p_provider: provider, p_subject: profile.subject, p_email: profile.email, p_name: profile.name, p_avatar: profile.avatar });
    if (error || !data?.user_id) { console.error("dm_login failed", error?.code, error?.message); throw new Error("login failed"); }
    const login = data as LoginResult;
    const token = await createSession(login.board_id, login.auth_version, true, "member", { userId: login.user_id, memberName: login.member_name });
    // 이 기기에 남아 있던 예전 세션(PIN 등)은 새 로그인 세션으로 대체합니다.
    const previous = cookieValue(req, SESSION_COOKIE);
    if (/^[0-9a-f]{64}$/.test(previous)) await db().from("access_sessions").delete().eq("token_hash", tokenHash(previous));
    const destination = login.board_id || next.startsWith("/invite/") ? next : "/folders";
    // 이름·사진은 카카오·구글 프로필을 그대로 씁니다(설정에서 변경). 약관은 처음(또는 약관이 바뀐 뒤) 한 번 동의를 받습니다.
    const target = await termsPending(login.user_id) ? consentPath(destination) : destination;
    return finish(setSessionCookie(NextResponse.redirect(new URL(target, req.url)), token, true));
  } catch (e) {
    if (!(e instanceof AccessError)) console.error(`OAuth ${provider} callback failed`, e instanceof Error ? e.message : e);
    return back("failed");
  }
}
