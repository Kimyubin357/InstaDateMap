import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, reset, tables } from "./fakeDb";
// 이름 변경의 기록 갱신·사진 규칙은 profiles-sql 테스트가 실제 SQL로 검증합니다.
const rpc = vi.fn();
vi.mock("@/lib/db", () => ({ db: () => ({ from: fakeDb.from, rpc }) }));
import { tokenHash } from "@/lib/token";
import { isAvatarData, profileInput } from "@/lib/profile";
import { GET, PATCH } from "@/app/api/profile/route";

const token = "b".repeat(64), user = "22222222-2222-4222-8222-222222222222";
const req = (method = "GET", body?: unknown, cookie = `datemap_session=${token}`) => new Request("http://localhost/api/profile", { method,
  headers: { cookie, origin: "http://localhost", "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
beforeEach(() => {
  reset(); rpc.mockReset();
  tables.access_sessions = [{ token_hash: tokenHash(token), board_id: null, purpose: "member", member_name: null, remember: true, auth_version: 0, expires_at: "2030-01-01T00:00:00Z", user_id: user }];
});

describe("프로필 입력 검사", () => {
  it("이름을 정리하고 길이를 검사하며, 직접 올린 사진은 작은 이미지 data URL만 받는다", () => {
    expect(profileInput({ name: "  유빈   김 ", avatar_mode: "keep" })).toEqual({ name: "유빈 김", mode: "keep", avatar: null });
    expect(profileInput({ name: "", avatar_mode: "keep" })).toMatch(/1~20자/);
    expect(profileInput({ name: "가".repeat(21) })).toMatch(/1~20자/);
    expect(profileInput({ name: "유빈", avatar_mode: "custom", avatar: "https://evil.example/a.png" })).toMatch(/사진을 다시/);
    expect(profileInput({ name: "유빈", avatar_mode: "weird" })).toMatchObject({ mode: "keep" });
    expect(isAvatarData("data:image/webp;base64,AAAA")).toBe(true);
    expect(isAvatarData("data:image/svg+xml;base64,AAAA")).toBe(false);
    expect(isAvatarData("data:image/png;base64," + "A".repeat(200001))).toBe(false);
  });
});

describe("프로필 API", () => {
  it("로그인이 필요하고, 폴더가 없는 계정도 프로필을 볼 수 있다", async () => {
    expect((await GET(req("GET", undefined, ""))).status).toBe(401);
    rpc.mockResolvedValueOnce({ data: { name: "유빈", avatar: null }, error: null });
    expect(await (await GET(req())).json()).toEqual({ name: "유빈", avatar: null });
    expect(rpc).toHaveBeenCalledWith("dm_get_profile", { p_user: user });
  });
  it("저장은 정리한 이름과 사진 설정을 보내고, 이름 겹침 같은 DB 안내는 그대로 보여준다", async () => {
    rpc.mockResolvedValueOnce({ data: { name: "유빈이" }, error: null });
    expect((await PATCH(req("PATCH", { name: " 유빈이 ", avatar_mode: "none" }))).status).toBe(200);
    expect(rpc).toHaveBeenLastCalledWith("dm_set_profile", { p_user: user, p_name: "유빈이", p_avatar_mode: "none", p_avatar: null });
    rpc.mockResolvedValueOnce({ data: null, error: { code: "P0001", message: "‘우리’ 폴더에 이미 같은 이름이 있어요. 다른 이름을 써 주세요." } });
    const conflict = await PATCH(req("PATCH", { name: "수민", avatar_mode: "keep" }));
    expect(conflict.status).toBe(409); expect((await conflict.json()).message).toMatch(/같은 이름/);
    expect((await PATCH(req("PATCH", { name: "" }))).status).toBe(400);
  });
});
