import { NextResponse } from "next/server";
import { safeNext } from "@/lib/auth";
import { authorizeUrl, callbackUrl, encodeOAuthCookie, isProvider, newState, OAUTH_COOKIE, providerConfig } from "@/lib/oauth";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 로그인 시작: 공급자 화면으로 보내고, 돌아올 때 대조할 state를 이 기기에만 남깁니다. */
export async function GET(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const url = new URL(req.url);
  const next = safeNext(url.searchParams.get("next"));
  const back = (error: string) => NextResponse.redirect(new URL(`/login?error=${error}&next=${encodeURIComponent(next)}`, req.url));
  if (!isProvider(provider)) return back("unavailable");
  const config = providerConfig(provider);
  if (!config) { console.error(`OAuth ${provider} is not configured: set its client ID/secret environment variables.`); return back("unavailable"); }
  const state = newState();
  const response = NextResponse.redirect(authorizeUrl(provider, config, callbackUrl(url.origin, provider), state));
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.cookies.set(OAUTH_COOKIE, encodeOAuthCookie(provider, state, next), { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/api/auth", maxAge: 600 });
  return response;
}
