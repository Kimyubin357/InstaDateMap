import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, reset, tables } from "./fakeDb";
const rpc = vi.fn();
vi.mock("@/lib/db", () => ({ db: () => ({ from: fakeDb.from, rpc }) }));
import { tokenHash } from "@/lib/pin";
import { GET, PATCH, POST } from "@/app/api/terms/route";
import { termsPending } from "@/lib/terms-server";
import { TERMS, TERMS_ORDER, TERMS_VERSION } from "@/lib/terms";

const token = "b".repeat(64), user = "u1";
const req = (method: string, body?: unknown, cookie = `datemap_session=${token}`) => new Request("http://localhost/api/terms", { method,
  headers: { cookie, origin: "http://localhost", "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
beforeEach(() => {
  reset(); rpc.mockReset();
  tables.access_sessions = [{ token_hash: tokenHash(token), board_id: null, purpose: "member", remember: true, auth_version: 0, expires_at: "2030-01-01T00:00:00Z", user_id: user }];
  tables.app_users = [{ id: user, terms_version: null }];
});

describe("약관 문서", () => {
  it("필수 3개·선택 1개이고, 개인정보 처리방침은 위치를 서버에 저장하지 않는다고 밝힌다", () => {
    expect(TERMS_ORDER.map((k) => [k, TERMS[k].required])).toEqual([["service", true], ["privacy", true], ["location", true], ["marketing", false]]);
    expect(JSON.stringify(TERMS.privacy)).toContain("서버에 저장하지 않습니다");
  });
});

describe("약관 동의 API", () => {
  it("로그인이 필요하고, 필수 약관이 빠지면 DB에 보내지 않는다", async () => {
    expect((await POST(req("POST", {}, ""))).status).toBe(401);
    const missing = await POST(req("POST", { service: true, privacy: true, location: false, marketing: true }));
    expect(missing.status).toBe(400); expect(rpc).not.toHaveBeenCalled();
  });
  it("동의는 서버의 현재 약관 버전으로 기록하고, 동의 전후 상태를 판단한다", async () => {
    expect(await termsPending(user)).toBe(true);
    rpc.mockResolvedValueOnce({ data: { terms_version: TERMS_VERSION, marketing: false }, error: null });
    expect((await POST(req("POST", { service: true, privacy: true, location: true, marketing: "yes" }))).status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("dm_agree_terms", { p_user: user, p_version: TERMS_VERSION, p_service: true, p_privacy: true, p_location: true, p_marketing: false });
    tables.app_users[0].terms_version = TERMS_VERSION;
    expect(await termsPending(user)).toBe(false);
    tables.app_users[0].terms_version = "2000-01-01";
    expect(await termsPending(user)).toBe(true);
  });
  it("광고성 정보 수신은 true/false만 받고, 상태에는 현재 약관 버전을 함께 준다", async () => {
    expect((await PATCH(req("PATCH", { marketing: "on" }))).status).toBe(400);
    rpc.mockResolvedValueOnce({ data: { marketing: true }, error: null });
    expect((await PATCH(req("PATCH", { marketing: true }))).status).toBe(200);
    rpc.mockResolvedValueOnce({ data: { terms_version: null, marketing: false }, error: null });
    expect(await (await GET(req("GET"))).json()).toEqual({ terms_version: null, marketing: false, current_version: TERMS_VERSION });
  });
});
