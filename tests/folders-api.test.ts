import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, reset, tables } from "./fakeDb";
// 폴더 규칙 자체는 folders-sql 테스트가 실제 SQL로 검증합니다. 여기서는 API의 인증·입력·응답만 봅니다.
const rpc = vi.fn();
vi.mock("@/lib/db", () => ({ db: () => ({ from: fakeDb.from, rpc }) }));
import { tokenHash } from "@/lib/pin";
import { GET as list, POST as create } from "@/app/api/folders/route";
import { DELETE as remove, PATCH as update } from "@/app/api/folders/[id]/route";
import { POST as open } from "@/app/api/folders/[id]/open/route";
import { DELETE as revoke, POST as makeInvite } from "@/app/api/folders/[id]/invites/route";
import { DELETE as leave } from "@/app/api/folders/[id]/members/[userId]/route";
import { GET as preview, POST as accept } from "@/app/api/invites/[token]/route";

const account = "b".repeat(64), legacy = "a".repeat(64);
const folder = "11111111-1111-4111-8111-111111111111", user = "22222222-2222-4222-8222-222222222222";
const ok = (data: unknown) => Promise.resolve({ data, error: null });
function req(path: string, method = "GET", body?: unknown, token = account) {
  return new Request(`http://localhost/api/${path}`, { method, headers: { cookie: `datemap_session=${token}`, origin: "http://localhost", "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
const p = <T,>(value: T) => ({ params: Promise.resolve(value) });
beforeEach(() => {
  reset(); rpc.mockReset();
  tables.access_sessions = [
    { token_hash: tokenHash(account), board_id: folder, purpose: "member", member_name: "유빈", remember: true, auth_version: 0, expires_at: "2030-01-01T00:00:00Z", user_id: user },
    { token_hash: tokenHash(legacy), board_id: "legacy", purpose: "member", member_name: "유빈", remember: true, auth_version: 0, expires_at: "2030-01-01T00:00:00Z" },
  ];
});

describe("폴더 API 인증과 입력", () => {
  it("로그인하지 않았거나 PIN 세션이면 401, 잘못된 폴더 id는 404", async () => {
    expect((await list(req("folders", "GET", undefined, "c".repeat(64)))).status).toBe(401);
    expect((await list(req("folders", "GET", undefined, legacy))).status).toBe(401);
    expect((await open(req("folders/x/open", "POST"), p({ id: "not-a-uuid" }))).status).toBe(404);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("외부 사이트의 변경 요청은 거절한다", async () => {
    const r = new Request("http://localhost/api/folders", { method: "POST", headers: { cookie: `datemap_session=${account}`, origin: "https://evil.test" }, body: "{}" });
    expect((await create(r)).status).toBe(403);
  });
  it("이름·색·아이콘을 검사하고, 만든 폴더를 이 기기에서 바로 연다", async () => {
    const bad = await create(req("folders", "POST", { name: " ", color: "red", icon: "heart" }));
    expect(bad.status).toBe(400); expect((await bad.json()).message).toMatch(/1~30자/);
    expect((await create(req("folders", "POST", { name: "부산", color: "purple", icon: "heart" }))).status).toBe(400);
    rpc.mockImplementation((name: string) => ok(name === "dm_create_folder" ? { board_id: folder } : {}));
    const res = await create(req("folders", "POST", { name: "  부산   여행 ", color: "blue", icon: "map" }));
    expect(await res.json()).toEqual({ id: folder, current: folder });
    expect(rpc.mock.calls[0]).toEqual(["dm_create_folder", { p_user: user, p_name: "부산 여행", p_color: "blue", p_icon: "map" }]);
    expect(rpc.mock.calls[1]).toEqual(["dm_switch_folder", { p_user: user, p_session: tokenHash(account), p_board: folder }]);
  });
  it("목록은 지금 보는 폴더와 함께 돌려준다", async () => {
    rpc.mockImplementation(() => ok([{ id: folder, name: "내 장소" }]));
    expect(await (await list(req("folders"))).json()).toEqual({ folders: [{ id: folder, name: "내 장소" }], current: folder });
  });
});

describe("DB 규칙 오류와 결과", () => {
  it("DB의 한국어 안내(P0001)는 그대로, 그 밖의 오류는 일반 안내로 바꾼다", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: "P0001", message: "폴더를 만든 사람만 바꿀 수 있어요." } });
    const denied = await update(req(`folders/${folder}`, "PATCH", { name: "제주", color: "gold", icon: "tree" }), p({ id: folder }));
    expect(denied.status).toBe(409); expect((await denied.json()).message).toBe("폴더를 만든 사람만 바꿀 수 있어요.");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    rpc.mockResolvedValueOnce({ data: null, error: { code: "XX000", message: "relation boards does not exist" } });
    const failed = await remove(req(`folders/${folder}`, "DELETE"), p({ id: folder }));
    expect(failed.status).toBe(500); expect((await failed.json()).message).not.toMatch(/relation/);
    spy.mockRestore();
  });
  it("삭제·나가기 뒤에는 이 기기가 보는 폴더를 알려준다(없으면 null)", async () => {
    rpc.mockImplementation(() => { tables.access_sessions[0].board_id = null; return ok(null); });
    expect(await (await remove(req(`folders/${folder}`, "DELETE"), p({ id: folder }))).json()).toEqual({ current: null });
    tables.access_sessions[0].board_id = "33333333-3333-4333-8333-333333333333";
    rpc.mockImplementation(() => ok(null));
    expect(await (await leave(req(`folders/${folder}/members/${user}`, "DELETE"), p({ id: folder, userId: user }))).json()).toEqual({ current: "33333333-3333-4333-8333-333333333333" });
  });
});

describe("초대 링크", () => {
  it("원문 토큰은 링크에만 담고 DB에는 해시만 보낸다", async () => {
    rpc.mockImplementation(() => ok({ expires_at: "2030-01-08T00:00:00Z" }));
    const body = await (await makeInvite(req(`folders/${folder}/invites`, "POST"), p({ id: folder }))).json();
    const token = /\/invite\/([0-9a-f]{64})$/.exec(body.url)![1];
    expect(rpc.mock.calls[0][1]).toEqual({ p_actor: user, p_board: folder, p_token_hash: tokenHash(token) });
    rpc.mockImplementation(() => ok(2));
    expect(await (await revoke(req(`folders/${folder}/invites`, "DELETE"), p({ id: folder }))).json()).toEqual({ revoked: 2 });
  });
  it("미리보기는 로그인 없이 되고, 형식이 틀린 링크는 DB를 조회하지 않는다", async () => {
    const anonymous = new Request("http://localhost/api/invites/x");
    expect(await (await preview(anonymous, p({ token: "short" }))).json()).toEqual({ code: "INVITE_INVALID" });
    expect(rpc).not.toHaveBeenCalled();
    rpc.mockImplementation(() => ok({ code: "OK", name: "부산" }));
    expect((await (await preview(anonymous, p({ token: "e".repeat(64) }))).json()).code).toBe("OK");
    expect(rpc.mock.calls[0][1]).toEqual({ p_token_hash: tokenHash("e".repeat(64)), p_user: null });
  });
  it("참여는 로그인이 필요하고, 참여한 폴더를 이 기기에서 연다", async () => {
    expect((await accept(req("invites/x", "POST", {}, "c".repeat(64)), p({ token: "e".repeat(64) }))).status).toBe(401);
    rpc.mockImplementation((name: string) => ok(name === "dm_accept_invite" ? { board_id: folder } : {}));
    expect(await (await accept(req("invites/x", "POST", {}), p({ token: "e".repeat(64) }))).json()).toEqual({ current: folder });
    expect(rpc.mock.calls.map((c) => c[0])).toEqual(["dm_accept_invite", "dm_switch_folder"]);
  });
});
