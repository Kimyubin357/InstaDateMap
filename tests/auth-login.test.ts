import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, reset, tables } from "./fakeDb";
vi.mock("@/lib/db", () => ({ db: () => fakeDb }));
import { hashPin, tokenHash } from "@/lib/pin";
import { boardFromRequest } from "@/lib/auth";
import { authorizeUrl, encodeOAuthCookie, exchangeProfile, loginError, readOAuthCookie } from "@/lib/oauth";
import { GET as start } from "@/app/api/auth/[provider]/route";
import { GET as callback } from "@/app/api/auth/[provider]/callback/route";
import { GET as linkState, POST as link } from "@/app/api/auth/link/route";
import { POST as lock } from "@/app/api/access/lock/route";

const params = (provider: string) => ({ params: Promise.resolve({ provider }) });
const state = "c".repeat(48);
const legacyToken = "a".repeat(64);
let pinHash: string;
beforeAll(async () => { pinHash = await hashPin("200102"); });
beforeEach(() => {
  reset(); vi.unstubAllEnvs(); vi.unstubAllGlobals();
  vi.stubEnv("KAKAO_REST_API_KEY", "kakao-rest"); vi.stubEnv("GOOGLE_CLIENT_ID", "google-id"); vi.stubEnv("GOOGLE_CLIENT_SECRET", "google-secret");
  tables.boards = [{ id: "legacy", name: "우리", token: "t", pin_hash: pinHash, auth_version: 2, member_names: ["유빈", "수민"] }];
  tables.access_sessions = [{ token_hash: tokenHash(legacyToken), board_id: "legacy", purpose: "member", member_name: "유빈", remember: true, auth_version: 2, expires_at: "2030-01-01T00:00:00Z" }];
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

function providerFetch(profile: Record<string, unknown>, tokenStatus = 200) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (/token/.test(url)) return new Response(JSON.stringify(tokenStatus === 200 ? { access_token: "provider-access" } : { error: "invalid_grant" }), { status: tokenStatus });
    return new Response(JSON.stringify(profile), { status: 200 });
  });
  return { fetcher, calls };
}
const kakaoProfile = { id: 4242, kakao_account: { email: "yubin@kakao.test", is_email_valid: true, profile: { nickname: "유빈", profile_image_url: "https://k.kakaocdn.net/a.jpg", is_default_image: false } } };
const sessionCookie = (res: Response) => /datemap_session=([0-9a-f]{64})/.exec(res.headers.get("set-cookie") || "")?.[1] ?? "";
function callbackRequest(provider: string, query: string, cookieState = state, extraCookie = "") {
  const oauth = encodeOAuthCookie(provider as "kakao", cookieState, "/add?url=https%3A%2F%2Fwww.instagram.com%2Fp%2FX%2F");
  return new Request(`http://localhost:3000/api/auth/${provider}/callback?${query}`, { headers: { cookie: `datemap_oauth=${oauth}${extraCookie}` } });
}

describe("로그인 시작과 state", () => {
  it("공급자 화면으로 보내고 state·돌아갈 주소를 HttpOnly 쿠키에만 남긴다", async () => {
    const res = await start(new Request("http://localhost:3000/api/auth/kakao?next=%2Fsettings"), params("kakao"));
    const location = new URL(res.headers.get("location")!);
    expect(location.origin + location.pathname).toBe("https://kauth.kakao.com/oauth/authorize");
    expect(location.searchParams.get("client_id")).toBe("kakao-rest");
    expect(location.searchParams.get("redirect_uri")).toBe("http://localhost:3000/api/auth/kakao/callback");
    const cookie = res.headers.get("set-cookie")!;
    expect(cookie).toMatch(/datemap_oauth=/); expect(cookie).toMatch(/HttpOnly/i); expect(cookie).toMatch(/Path=\/api\/auth/);
    expect(readOAuthCookie(/datemap_oauth=([^;]+)/.exec(cookie)![1], "kakao", location.searchParams.get("state"))).toEqual({ next: "/settings" });
  });
  it("구글은 openid 범위와 계정 선택을 요청한다", () => {
    const url = new URL(authorizeUrl("google", { clientId: "g", clientSecret: "s" }, "http://x/cb", state));
    expect(url.searchParams.get("scope")).toBe("openid email profile"); expect(url.searchParams.get("prompt")).toBe("select_account");
  });
  it("설정이 없거나 모르는 공급자는 로그인 화면의 한국어 안내로 돌아간다", async () => {
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "");
    const res = await start(new Request("http://localhost/api/auth/google"), params("google"));
    expect(res.headers.get("location")).toContain("/login?error=unavailable");
    expect((await start(new Request("http://localhost/api/auth/naver"), params("naver"))).headers.get("location")).toContain("error=unavailable");
    expect(loginError("unavailable")).toMatch(/다른 방법/); expect(loginError("<script>")).toBe("");
  });
  it("state가 다르거나 다른 공급자의 쿠키면 거절하고, 외부 돌아갈 주소는 지도 홈으로 바꾼다", () => {
    const cookie = encodeOAuthCookie("kakao", state, "https://evil.test/");
    expect(() => readOAuthCookie(cookie, "kakao", "d".repeat(48))).toThrow();
    expect(() => readOAuthCookie(cookie, "google", state)).toThrow();
    expect(() => readOAuthCookie("not-json", "kakao", state)).toThrow();
    expect(readOAuthCookie(cookie, "kakao", state)).toEqual({ next: "/" });
  });
});

describe("공급자 사용자 정보", () => {
  it("카카오: 숫자 id·닉네임·https 사진만 남기고 비밀키가 있으면 함께 보낸다", async () => {
    const { fetcher, calls } = providerFetch(kakaoProfile);
    const profile = await exchangeProfile("kakao", { clientId: "k", clientSecret: "secret" }, "http://x/cb", "code-1", fetcher as unknown as typeof fetch);
    expect(profile).toEqual({ subject: "4242", name: "유빈", email: "yubin@kakao.test", avatar: "https://k.kakaocdn.net/a.jpg" });
    expect(String(calls[0].init?.body)).toContain("client_secret=secret");
    expect((calls[1].init?.headers as Record<string, string>).Authorization).toBe("Bearer provider-access");
  });
  it("구글: sub·이름·확인된 이메일을 사용하고 확인되지 않은 이메일은 버린다", async () => {
    const { fetcher } = providerFetch({ sub: "g-1", name: "Su Min", email: "s@gmail.test", email_verified: false, picture: "http://insecure/a.png" });
    expect(await exchangeProfile("google", { clientId: "g", clientSecret: "s" }, "http://x/cb", "c", fetcher as unknown as typeof fetch))
      .toEqual({ subject: "g-1", name: "Su Min", email: null, avatar: null });
  });
  it("토큰 교환 실패는 공급자 원문 대신 한국어 오류로 바꾼다", async () => {
    const { fetcher } = providerFetch(kakaoProfile, 400);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(exchangeProfile("kakao", { clientId: "k" }, "http://x/cb", "c", fetcher as unknown as typeof fetch)).rejects.toThrow("로그인 정보를 받아오지 못했어요");
    spy.mockRestore();
  });
});

describe("로그인 완료", () => {
  it("계정과 내 장소를 만들고 90일 세션으로 원래 가려던 주소에 보내며, 예전 PIN 세션은 지운다", async () => {
    vi.stubGlobal("fetch", providerFetch(kakaoProfile).fetcher);
    const res = await callback(callbackRequest("kakao", `code=abc&state=${state}`, state, `; datemap_session=${legacyToken}`), params("kakao"));
    // 처음 가입하면 이름·사진 확인 화면을 거쳐 원래 가려던 주소로 갑니다.
    expect(res.headers.get("location")).toBe(`http://localhost:3000/welcome?next=${encodeURIComponent("/add?url=https%3A%2F%2Fwww.instagram.com%2Fp%2FX%2F")}`);
    expect(res.headers.get("set-cookie")).toMatch(/Max-Age=7776000/);
    expect(res.headers.get("set-cookie")).toMatch(/datemap_oauth=;/);
    const token = sessionCookie(res);
    const board = await boardFromRequest(new Request("http://localhost/", { headers: { cookie: `datemap_session=${token}` } }));
    expect(board).toMatchObject({ name: "내 장소", who: "유빈", memberNames: ["유빈"] });
    expect(board?.userId).toBe(tables.app_users[0].id);
    expect(tables.access_sessions.some((s) => s.token_hash === tokenHash(legacyToken))).toBe(false);
  });
  it("동의 취소·state 불일치·코드 없음은 세션 없이 로그인 화면으로 돌아간다", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    const cancelled = await callback(callbackRequest("kakao", `error=access_denied&state=${state}`), params("kakao"));
    expect(cancelled.headers.get("location")).toContain("/login?error=cancelled");
    const mismatch = await callback(callbackRequest("kakao", `code=abc&state=${"d".repeat(48)}`), params("kakao"));
    expect(mismatch.headers.get("location")).toContain("error=expired");
    const noCode = await callback(callbackRequest("kakao", `state=${state}`), params("kakao"));
    expect(noCode.headers.get("location")).toContain("error=failed");
    for (const res of [cancelled, mismatch, noCode]) expect(sessionCookie(res)).toBe("");
    expect(fetcher).not.toHaveBeenCalled(); expect(tables.app_users ?? []).toHaveLength(0);
  });
});

describe("가입 후 이름 확인", () => {
  it("이름을 확인한 계정은 다음 로그인부터 원래 가려던 주소로 바로 간다", async () => {
    vi.stubGlobal("fetch", providerFetch(kakaoProfile).fetcher);
    await callback(callbackRequest("kakao", `code=abc&state=${state}`), params("kakao"));
    tables.app_users[0].name_confirmed = true;
    const again = await callback(callbackRequest("kakao", `code=def&state=${state}`), params("kakao"));
    expect(again.headers.get("location")).toBe("http://localhost:3000/add?url=https%3A%2F%2Fwww.instagram.com%2Fp%2FX%2F");
  });
  it("카카오의 http 프로필 사진 주소는 https로 바꾸고, 다른 http 주소는 버린다", async () => {
    const http = { ...kakaoProfile, kakao_account: { ...kakaoProfile.kakao_account, profile: { nickname: "유빈", profile_image_url: "http://k.kakaocdn.net/dn/a.jpg" } } };
    expect((await exchangeProfile("kakao", { clientId: "k" }, "http://x/cb", "c", providerFetch(http).fetcher as unknown as typeof fetch)).avatar).toBe("https://k.kakaocdn.net/dn/a.jpg");
    const other = { ...kakaoProfile, kakao_account: { ...kakaoProfile.kakao_account, profile: { nickname: "유빈", profile_image_url: "http://evil.example/a.jpg" } } };
    expect((await exchangeProfile("kakao", { clientId: "k" }, "http://x/cb", "c", providerFetch(other).fetcher as unknown as typeof fetch)).avatar).toBeNull();
  });
});

describe("계정 세션과 기존 지도 연결", () => {
  async function loggedIn() {
    vi.stubGlobal("fetch", providerFetch(kakaoProfile).fetcher);
    const token = sessionCookie(await callback(callbackRequest("kakao", `code=abc&state=${state}`), params("kakao")));
    return (path: string, body?: unknown) => new Request(`http://localhost/api/${path}`, { method: body === undefined ? "GET" : "POST",
      headers: { cookie: `datemap_session=${token}`, origin: "http://localhost", "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  }
  it("폴더에서 빠진 계정의 세션은 열리지 않는다", async () => {
    const req = await loggedIn();
    expect(await boardFromRequest(req("auth/link"))).not.toBeNull();
    tables.board_members = [];
    expect(await boardFromRequest(req("auth/link"))).toBeNull();
  });
  it("PIN과 이름으로 기존 지도에 연결하면 이 기기가 기존 지도를 연다", async () => {
    const req = await loggedIn();
    expect(await (await linkState(req("auth/link"))).json()).toEqual({ available: true, linked: null, names: ["유빈", "수민"] });
    const wrong = await link(req("auth/link", { name: "유빈", pin: "111111" }));
    expect(wrong.status).toBe(401); expect((await wrong.json()).message).toMatch(/PIN이 맞지 않아요/);
    const ok = await link(req("auth/link", { name: "유빈", pin: "200102" }));
    expect(ok.status).toBe(200);
    const board = await boardFromRequest(req("auth/link"));
    expect(board).toMatchObject({ id: "legacy", who: "유빈", memberNames: ["유빈", "수민"], authVersion: 2 });
    expect(await (await linkState(req("auth/link"))).json()).toEqual({ available: true, linked: "유빈", names: ["유빈", "수민"] });
  });
  it("다른 계정이 쓰는 이름은 고를 수 없고, PIN 세션은 연결 API를 쓸 수 없다", async () => {
    tables.app_users = [{ id: "other" }]; tables.board_members = [{ board_id: "legacy", user_id: "other", role: "owner", member_name: "유빈", joined_at: "2026-01-01" }];
    const req = await loggedIn();
    expect((await (await linkState(req("auth/link"))).json()).names).toEqual(["수민"]);
    expect((await link(req("auth/link", { name: "유빈", pin: "200102" }))).status).toBe(400);
    const pinSession = new Request("http://localhost/api/auth/link", { headers: { cookie: `datemap_session=${legacyToken}` } });
    expect((await linkState(pinSession)).status).toBe(409);
  });
  it("로그아웃은 이 기기의 세션만 지우고 로그인 화면으로 보낸다", async () => {
    const req = await loggedIn();
    const res = await lock(req("access/lock", {}));
    expect(await res.json()).toEqual({ next: "/login" });
    expect(await boardFromRequest(req("auth/link"))).toBeNull();
    expect(tables.access_sessions.some((s) => s.token_hash === tokenHash(legacyToken))).toBe(true);
  });
});
