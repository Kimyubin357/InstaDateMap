import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, reset, tables } from "./fakeDb";
vi.mock("@/lib/db", () => ({ db: () => fakeDb }));
import { tokenHash } from "@/lib/token";
import { boardFromRequest, safeNext } from "@/lib/auth";
import { POST as lock } from "@/app/api/access/lock/route";
const token = "a".repeat(64);
const pinToken = "b".repeat(64);
const user = "11111111-1111-4111-8111-111111111111";
beforeEach(() => {
  reset(); vi.unstubAllEnvs();
  tables.boards = [{ id: "b1", name: "우리", auth_version: 1, member_names: ["민지", "준호"] }];
  tables.board_members = [{ board_id: "b1", user_id: user, role: "owner", member_name: "민지", joined_at: "2026-01-01" }];
  tables.access_sessions = [
    { token_hash: tokenHash(token), board_id: "b1", purpose: "member", member_name: "민지", remember: true, auth_version: 1, expires_at: "2030-01-01T00:00:00Z", user_id: user },
    // 2026-11-24 이전의 PIN 세션: user_id가 없어 더 이상 열리지 않습니다.
    { token_hash: tokenHash(pinToken), board_id: "b1", purpose: "member", member_name: "준호", remember: true, auth_version: 1, expires_at: "2030-01-01T00:00:00Z", user_id: null },
  ];
});
function req(path: string, body?: unknown, cookie = `datemap_session=${token}`, origin = "http://localhost") {
  return new Request(`http://localhost/api/access/${path}`, { method: body === undefined ? "GET" : "POST", headers: { cookie, origin, "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
describe("계정 세션 입장", () => {
  it("예전 PIN 세션과 예전 토큰 주소로는 열리지 않음", async () => {
    expect(await boardFromRequest(req("", undefined, `datemap_session=${pinToken}`))).toBeNull();
    expect(await boardFromRequest(new Request("http://localhost/?t=old-token", { headers: { "x-board-token": "old-token" } }))).toBeNull();
  });
  it("만료·다른 버전·멤버가 아닌 세션을 거절", async () => {
    expect((await boardFromRequest(req("")))?.who).toBe("민지");
    tables.access_sessions[0].expires_at = "2000-01-01"; expect(await boardFromRequest(req(""))).toBeNull();
    tables.access_sessions[0].expires_at = "2030-01-01"; tables.access_sessions[0].auth_version = 0; expect(await boardFromRequest(req(""))).toBeNull();
    tables.access_sessions[0].auth_version = 1; tables.access_sessions[0].purpose = "setup"; expect(await boardFromRequest(req(""))).toBeNull();
    tables.access_sessions[0].purpose = "member"; tables.board_members = []; expect(await boardFromRequest(req(""))).toBeNull();
  });
  it("외부 Origin과 Origin 없는 변경 요청을 거절", async () => {
    expect((await lock(req("lock", {}, undefined, "https://evil.test"))).status).toBe(403);
    expect((await lock(new Request("http://localhost/api/access/lock", { method: "POST" }))).status).toBe(403);
  });
  it("로그아웃하면 이 기기의 서버 세션만 폐기", async () => {
    const res = await lock(req("lock", {})); expect(res.status).toBe(200); expect(await res.json()).toEqual({ next: "/login" });
    expect(tables.access_sessions.map((s) => s.token_hash)).toEqual([tokenHash(pinToken)]); expect(await boardFromRequest(req(""))).toBeNull();
  });
  it("폴더가 없는 계정 세션도 로그아웃으로 지움", async () => {
    tables.access_sessions[0].board_id = null;
    expect((await lock(req("lock", {}))).status).toBe(200); expect(tables.access_sessions).toHaveLength(1);
  });
  it("외부 리다이렉트를 차단하고 URL에서 예전 인증 값을 제거", () => {
    expect(safeNext("https://evil.test")).toBe("/"); expect(safeNext("//evil.test")).toBe("/"); expect(safeNext("/\\evil.test")).toBe("/");
    expect(safeNext("/add?url=test&t=secret&who=name")).toBe("/add?url=test");
    expect(safeNext("/search?q=%EC%88%98%EC%9B%90&t=secret&who=name")).toBe("/search?q=%EC%88%98%EC%9B%90");
    expect(safeNext("/settings/link")).toBe("/");
  });
});
