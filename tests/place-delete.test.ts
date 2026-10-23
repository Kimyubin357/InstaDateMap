import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, failNext, reset, tables } from "./fakeDb";
import { tokenHash } from "@/lib/pin";
vi.mock("@/lib/db", () => ({ db: () => fakeDb }));
import { DELETE } from "@/app/api/places/[id]/route";
const request = (authenticated = true, origin = "http://localhost") => new Request("http://localhost/api/places/p1", { method: "DELETE", headers: { origin, ...(authenticated ? { cookie: `datemap_session=${"a".repeat(64)}` } : {}) } });
beforeEach(() => {
  reset(); tables.boards = [{ id: "b1", name: "지도", member_names: ["우리", "서로"], auth_version: 1 }];
  tables.access_sessions = [{ token_hash: tokenHash("a".repeat(64)), board_id: "b1", purpose: "member", member_name: "우리", auth_version: 1, expires_at: "2030-01-01" }];
  tables.places = [{ id: "p1", board_id: "b1" }, { id: "p2", board_id: "b2" }];
  tables.source_places = [{ source_id: "s1", place_id: "p1" }]; tables.place_saves = [{ board_id: "b1", place_id: "p1", added_by: "우리" }, { board_id: "b1", place_id: "p1", added_by: "서로" }];
});
describe("장소 삭제와 서버 확인", () => {
  it("실제로 삭제한 장소 ID를 반환하며 연결·두 사람 기록도 삭제", async () => {
    const response = await DELETE(request(), { params: Promise.resolve({ id: "p1" }) });
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ ok: true, deleted_id: "p1", already_deleted: false });
    expect(tables.places).toEqual([{ id: "p2", board_id: "b2" }]); expect(tables.source_places).toEqual([]); expect(tables.place_saves).toEqual([]);
  });
  it("응답 유실 후 재시도와 상대방이 이미 삭제한 장소도 안전하게 완료", async () => {
    await DELETE(request(), { params: Promise.resolve({ id: "p1" }) });
    expect(await (await DELETE(request(), { params: Promise.resolve({ id: "p1" }) })).json()).toEqual({ ok: true, deleted_id: "p1", already_deleted: true });
  });
  it("다른 보드의 장소는 삭제하지 않고 해당 보드 안에서의 부재만 확인", async () => {
    expect(await (await DELETE(request(), { params: Promise.resolve({ id: "p2" }) })).json()).toEqual({ ok: true, deleted_id: "p2", already_deleted: true });
    expect(tables.places).toHaveLength(2);
  });
  it("DB 장애를 성공으로 반환하지 않고 재시도할 장소를 보존", async () => {
    failNext("places", "delete"); const response = await DELETE(request(), { params: Promise.resolve({ id: "p1" }) });
    expect(response.status).toBe(500); expect((await response.json()).message).toContain("삭제하지 못했어요"); expect(tables.places).toHaveLength(2);
  });
  it("인증 없음·외부 Origin·이름 미선택은 삭제 전에 거절", async () => {
    expect((await DELETE(request(false), { params: Promise.resolve({ id: "p1" }) })).status).toBe(401);
    expect((await DELETE(request(true, "https://elsewhere.example"), { params: Promise.resolve({ id: "p1" }) })).status).toBe(403);
    tables.access_sessions[0].member_name = null;
    expect((await DELETE(request(), { params: Promise.resolve({ id: "p1" }) })).status).toBe(409); expect(tables.places).toHaveLength(2);
  });
});
