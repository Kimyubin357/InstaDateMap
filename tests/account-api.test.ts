import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, reset, tables } from "./fakeDb";
vi.mock("@/lib/db", () => ({ db: () => fakeDb }));
import { tokenHash } from "@/lib/token";
import { DELETE } from "@/app/api/account/route";
const token = "a".repeat(64);
const user = "11111111-1111-4111-8111-111111111111";
const req = (cookie = `datemap_session=${token}`, origin = "http://localhost") => new Request("http://localhost/api/account", { method: "DELETE", headers: { cookie, origin, "Content-Type": "application/json" }, body: "{}" });
beforeEach(() => {
  reset(); vi.restoreAllMocks();
  tables.access_sessions = [{ token_hash: tokenHash(token), board_id: null, purpose: "member", member_name: null, remember: true, auth_version: 0, expires_at: "2030-01-01T00:00:00Z", user_id: user }];
});
describe("회원 탈퇴 API", () => {
  it("로그인과 같은 사이트 요청이 필요하고, 거절되면 DB 함수를 부르지 않는다", async () => {
    const rpc = vi.spyOn(fakeDb, "rpc");
    expect((await DELETE(req(`datemap_session=${"c".repeat(64)}`))).status).toBe(401);
    expect((await DELETE(req(undefined, "https://evil.test"))).status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("내 계정만 지우고 쿠키를 지운 뒤 로그인 화면으로 보낸다", async () => {
    const rpc = vi.spyOn(fakeDb, "rpc").mockResolvedValueOnce({ data: { deleted_folders: 1, left_folders: 2 }, error: null });
    const res = await DELETE(req());
    expect(res.status).toBe(200); expect(await res.json()).toEqual({ next: "/login", deleted_folders: 1, left_folders: 2 });
    expect(rpc).toHaveBeenCalledWith("dm_delete_account", { p_user: user });
    expect(res.headers.get("set-cookie")).toMatch(/datemap_session=;/);
  });
  it("DB 원문 오류는 숨기고 한국어 안내만 보낸다", async () => {
    vi.spyOn(fakeDb, "rpc").mockResolvedValueOnce({ data: null, error: { message: "relation does not exist", code: "42P01" } } as never);
    const res = await DELETE(req());
    expect(res.status).toBe(500); expect((await res.json()).message).toBe("탈퇴하지 못했어요. 잠시 후 다시 시도해 주세요.");
  });
});
