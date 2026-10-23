import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, failNext, reset, tables } from "./fakeDb";
import { tokenHash } from "@/lib/pin";
vi.mock("@/lib/db", () => ({ db: () => fakeDb }));
import { GET as listTrash } from "@/app/api/trash/route";
import { POST as restore, DELETE as purge } from "@/app/api/trash/[id]/route";
import { GET as readPlace } from "@/app/api/places/[id]/route";
import { DELETE } from "@/app/api/places/[id]/route";
const request = (authenticated = true, origin = "http://localhost") => new Request("http://localhost/api/places/p1", { method: "DELETE", headers: { origin, ...(authenticated ? { cookie: `datemap_session=${"a".repeat(64)}` } : {}) } });
beforeEach(() => {
  reset(); tables.boards = [{ id: "b1", name: "지도", member_names: ["우리", "서로"], auth_version: 1 }];
  tables.access_sessions = [{ token_hash: tokenHash("a".repeat(64)), board_id: "b1", purpose: "member", member_name: "우리", auth_version: 1, expires_at: "2030-01-01" }];
  tables.places = [{ id: "p1", board_id: "b1" }, { id: "p2", board_id: "b2" }];
  tables.source_places = [{ source_id: "s1", place_id: "p1" }]; tables.place_saves = [{ board_id: "b1", place_id: "p1", added_by: "우리" }, { board_id: "b1", place_id: "p1", added_by: "서로" }];
});
describe("장소 삭제와 서버 확인", () => {
  it("삭제한 장소 ID를 반환하며 연결·두 사람 기록을 복구용으로 보존", async () => {
    const response = await DELETE(request(), { params: Promise.resolve({ id: "p1" }) });
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ ok: true, deleted_id: "p1", already_deleted: false });
    expect(tables.places).toHaveLength(2); expect(tables.places[0].deleted_at).toBeTruthy(); expect(tables.source_places).toHaveLength(1); expect(tables.place_saves).toHaveLength(2);
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
    failNext("places", "update"); const response = await DELETE(request(), { params: Promise.resolve({ id: "p1" }) });
    expect(response.status).toBe(500); expect((await response.json()).message).toContain("삭제하지 못했어요"); expect(tables.places).toHaveLength(2);
  });
  it("인증 없음·외부 Origin·이름 미선택은 삭제 전에 거절", async () => {
    expect((await DELETE(request(false), { params: Promise.resolve({ id: "p1" }) })).status).toBe(401);
    expect((await DELETE(request(true, "https://elsewhere.example"), { params: Promise.resolve({ id: "p1" }) })).status).toBe(403);
    tables.access_sessions[0].member_name = null;
    expect((await DELETE(request(), { params: Promise.resolve({ id: "p1" }) })).status).toBe(409); expect(tables.places).toHaveLength(2);
  });
});

const route = { params: Promise.resolve({ id: "p1" }) };
const trashRequest = (method: string, deleted_at: unknown, origin = "http://localhost") => new Request("http://localhost/api/trash/p1", { method, headers: { origin, cookie: `datemap_session=${"a".repeat(64)}`, "Content-Type": "application/json" }, body: JSON.stringify({ deleted_at }) });
it("trash list is board scoped and restore makes the original record readable", async () => {
  await DELETE(request(), route);
  tables.places[1].deleted_at = "2026-10-24T00:00:00Z";
  const get = () => new Request("http://localhost/api/trash", { headers: { cookie: `datemap_session=${"a".repeat(64)}` } });
  expect((await (await listTrash(get())).json()).places.map((p: any) => p.id)).toEqual(["p1"]);
  expect((await readPlace(get(), route)).status).toBe(404);
  expect((await restore(trashRequest("POST", tables.places[0].deleted_at), route)).status).toBe(200);
  expect((await readPlace(get(), route)).status).toBe(200);
  expect((await (await listTrash(get())).json()).places).toEqual([]);
});
it("permanent deletion removes the place and links and is safe to retry", async () => {
  await DELETE(request(), route); const stamp = tables.places[0].deleted_at;
  expect((await purge(trashRequest("DELETE", stamp), route)).status).toBe(200);
  expect(tables.places.map((r) => r.id)).toEqual(["p2"]);
  expect(tables.source_places).toEqual([]); expect(tables.place_saves).toEqual([]);
  expect((await purge(trashRequest("DELETE", stamp), route)).status).toBe(200);
  expect((await restore(trashRequest("POST", stamp), route)).status).toBe(404);
});
it("purge rejects missing timestamps, stale lists and cross-origin requests", async () => {
  await DELETE(request(), route); const stamp = tables.places[0].deleted_at;
  expect((await purge(trashRequest("DELETE", null), route)).status).toBe(400);
  expect((await purge(trashRequest("DELETE", "2000-01-01"), route)).status).toBe(409);
  expect((await purge(trashRequest("DELETE", stamp, "https://elsewhere.example"), route)).status).toBe(403);
  await restore(trashRequest("POST", stamp), route);
  expect((await purge(trashRequest("DELETE", stamp), route)).status).toBe(409);
  expect(tables.places).toHaveLength(2);
});
it("purge failures retain records and do not expose raw DB errors", async () => {
  await DELETE(request(), route); failNext("places", "delete", "sensitive database detail");
  const response = await purge(trashRequest("DELETE", tables.places[0].deleted_at), route);
  expect(response.ok).toBe(false); expect(await response.text()).not.toContain("sensitive database");
  expect(tables.places).toHaveLength(2);
});

it("restore returns the confirmed place with memo, status, sharers and sources for immediate map update", async () => {
  Object.assign(tables.places[0], { name: "어부의딸", kakao_place_id: "123", lat: 37.5, lng: 127, status: "again", memo: "토요일 · 주차 가능", created_at: "2026-10-01" });
  tables.sources = [{ id: "s1", board_id: "b1", url: "https://www.instagram.com/p/ABC/", media_type: "post" }];
  tables.source_places[0].added_by = "우리"; tables.board_sync = [{ board_id: "b1", revision: "8" }];
  await DELETE(request(), route);
  const response = await restore(trashRequest("POST", tables.places[0].deleted_at), route);
  expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toMatchObject({ ok: true, saved_place: { boardId: "b1", authVersion: 1, revision: "8", place: {
    id: "p1", memo: "토요일 · 주차 가능", status: "again", sharers: ["우리", "서로"], sources: [{ url: "https://www.instagram.com/p/ABC/", media_type: "post" }],
  } } });
});
it("preview read failure preserves a successful restore so a full refresh can recover", async () => {
  await DELETE(request(), route); const stamp = tables.places[0].deleted_at;
  failNext("places", "select");
  const response = await restore(trashRequest("POST", stamp), route);
  expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ ok: true });
  expect(tables.places[0].deleted_at).toBeNull();
});
