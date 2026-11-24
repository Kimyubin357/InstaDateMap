import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, reset, tables } from "./fakeDb";
const rpc = vi.fn();
vi.mock("@/lib/db", () => ({ db: () => ({ from: fakeDb.from, rpc }) }));
import { tokenHash } from "@/lib/token";
import { GET, PATCH, POST } from "@/app/api/terms/route";
import { termsPending } from "@/lib/terms-server";
import { marketingResultNotice, TERMS, TERMS_ORDER, TERMS_VERSION } from "@/lib/terms";

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
    expect(JSON.stringify(TERMS.privacy)).toContain("서버로 보내거나 저장하지 않습니다");
  });
  it("처리방침에 법정 기재사항이 모두 있고, 빈칸 없이 운영자 정보가 들어 있다", () => {
    const headings = TERMS.privacy.sections.map((s) => s.heading).join("|");
    for (const item of ["처리 목적", "처리하는 개인정보", "보유 기간", "제3자 제공", "국외 이전", "파기", "권리", "안전성", "쿠키", "보호책임자", "권익 침해 구제", "변경"]) expect(headings).toContain(item);
    const all = JSON.stringify(TERMS);
    expect(all).not.toContain("입력 필요"); expect(all).toContain("kimyubin357@gmail.com"); expect(all).toContain("만 14세 미만");
    expect(JSON.stringify(TERMS.service)).toContain("고의 또는 중대한 과실");
  });
  it("광고성 정보 수신 결과 안내에는 전송자·날짜·결과가 들어간다", () => {
    expect(marketingResultNotice(false, new Date("2026-11-24T03:00:00Z"))).toBe("데이트맵 광고성 정보 수신 거부 처리 완료 (2026년 11월 24일)");
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
