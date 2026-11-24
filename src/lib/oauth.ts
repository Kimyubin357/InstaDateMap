import { randomBytes, timingSafeEqual } from "node:crypto";
import { AccessError, safeNext } from "./auth";

export type Provider = "kakao" | "google";
export const PROVIDERS: Provider[] = ["kakao", "google"];
export const OAUTH_COOKIE = "datemap_oauth";
export const isProvider = (value: unknown): value is Provider => value === "kakao" || value === "google";

export interface ProviderProfile { subject: string; name: string; email: string | null; avatar: string | null }
interface ProviderConfig { clientId: string; clientSecret?: string }

/** 운영자용 설정 이름은 로그에만 남깁니다. */
export function providerConfig(provider: Provider): ProviderConfig | null {
  if (provider === "kakao") {
    const clientId = process.env.KAKAO_LOGIN_CLIENT_ID || process.env.KAKAO_REST_API_KEY;
    return clientId ? { clientId, clientSecret: process.env.KAKAO_LOGIN_CLIENT_SECRET || undefined } : null;
  }
  const clientId = process.env.GOOGLE_CLIENT_ID, clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}
export const callbackUrl = (origin: string, provider: Provider) => `${origin}/api/auth/${provider}/callback`;

/** state는 로그인 시작 기기의 HttpOnly 쿠키와 대조합니다. 돌아갈 주소는 safeNext로만 복원합니다. */
export function newState() { return randomBytes(24).toString("hex"); }
export function encodeOAuthCookie(provider: Provider, state: string, next: string) {
  return Buffer.from(JSON.stringify({ p: provider, s: state, n: safeNext(next) })).toString("base64url");
}
export function readOAuthCookie(value: string, provider: Provider, state: string | null): { next: string } {
  let parsed: { p?: unknown; s?: unknown; n?: unknown } | null = null;
  try { parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")); } catch { parsed = null; }
  const expected = typeof parsed?.s === "string" ? parsed.s : "";
  if (!parsed || parsed.p !== provider || !state || !/^[0-9a-f]{48}$/.test(state) || expected.length !== state.length ||
    !timingSafeEqual(Buffer.from(expected), Buffer.from(state))) {
    throw new AccessError("로그인 시간이 지났어요. 처음부터 다시 시작해 주세요.", 400);
  }
  return { next: safeNext(typeof parsed.n === "string" ? parsed.n : "/") };
}

export function authorizeUrl(provider: Provider, config: ProviderConfig, redirectUri: string, state: string) {
  const url = new URL(provider === "kakao" ? "https://kauth.kakao.com/oauth/authorize" : "https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", state);
  if (provider === "google") { url.searchParams.set("scope", "openid email profile"); url.searchParams.set("prompt", "select_account"); }
  return url.toString();
}

type Fetcher = typeof fetch;
async function readJson(res: Response, step: string) {
  const body = await res.json().catch(() => null);
  if (!res.ok || !body) {
    console.error(`OAuth ${step} failed`, res.status, body && typeof body === "object" ? (body as Record<string, unknown>).error ?? (body as Record<string, unknown>).msg : "");
    throw new Error("로그인 정보를 받아오지 못했어요. 잠시 후 다시 시도해 주세요.");
  }
  return body as Record<string, any>;
}
const clean = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : null;
/** 카카오 프로필 사진은 http 주소로 오기도 해서 카카오 이미지 서버만 https로 바꿉니다. */
const httpsUrl = (value: unknown) => {
  const url = clean(value)?.replace(/^http:\/\/([a-z0-9-]+\.kakaocdn\.net\/)/i, "https://$1");
  return url && /^https:\/\//.test(url) && url.length <= 1000 ? url : null;
};

/** 인가 코드를 토큰으로 바꾸고, 공급자의 사용자 정보에서 필요한 값만 남깁니다. */
export async function exchangeProfile(provider: Provider, config: ProviderConfig, redirectUri: string, code: string, fetcher: Fetcher = fetch): Promise<ProviderProfile> {
  const form = new URLSearchParams({ grant_type: "authorization_code", client_id: config.clientId, redirect_uri: redirectUri, code });
  if (config.clientSecret) form.set("client_secret", config.clientSecret);
  const tokenUrl = provider === "kakao" ? "https://kauth.kakao.com/oauth/token" : "https://oauth2.googleapis.com/token";
  const token = await readJson(await fetcher(tokenUrl, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded;charset=utf-8" }, body: form, cache: "no-store" }), "token");
  if (typeof token.access_token !== "string") throw new Error("로그인 정보를 받아오지 못했어요. 잠시 후 다시 시도해 주세요.");
  const userUrl = provider === "kakao" ? "https://kapi.kakao.com/v2/user/me" : "https://openidconnect.googleapis.com/v1/userinfo";
  const user = await readJson(await fetcher(userUrl, { headers: { Authorization: `Bearer ${token.access_token}` }, cache: "no-store" }), "profile");
  if (provider === "kakao") {
    const account = user.kakao_account ?? {}, profile = account.profile ?? {};
    const subject = user.id == null ? "" : String(user.id);
    if (!/^\d{1,30}$/.test(subject)) throw new Error("로그인 정보를 받아오지 못했어요. 잠시 후 다시 시도해 주세요.");
    return { subject, name: clean(profile.nickname) ?? clean(user.properties?.nickname) ?? "",
      email: account.is_email_valid === false ? null : clean(account.email),
      avatar: profile.is_default_image ? null : httpsUrl(profile.profile_image_url ?? profile.thumbnail_image_url) };
  }
  const subject = clean(user.sub) ?? "";
  if (!subject || subject.length > 255) throw new Error("로그인 정보를 받아오지 못했어요. 잠시 후 다시 시도해 주세요.");
  return { subject, name: clean(user.name) ?? clean(user.given_name) ?? "", email: user.email_verified === false ? null : clean(user.email), avatar: httpsUrl(user.picture) };
}

/** 로그인 화면에 보여줄 한국어 안내. 공급자 원문 오류는 화면에 보내지 않습니다. */
export const LOGIN_ERRORS: Record<string, string> = {
  cancelled: "로그인을 취소했어요. 다시 시도하려면 아래 버튼을 눌러 주세요.",
  expired: "로그인 시간이 지났어요. 처음부터 다시 시작해 주세요.",
  unavailable: "지금은 이 방법으로 로그인할 수 없어요. 다른 방법으로 시작해 주세요.",
  failed: "로그인하지 못했어요. 잠시 후 다시 시도해 주세요.",
};
export const loginError = (code: string | null | undefined) => (code && LOGIN_ERRORS[code]) || "";
