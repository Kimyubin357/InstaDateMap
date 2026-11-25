import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, reset, tables } from "./fakeDb";
// 방 고르기·전체 보기(2026-11-25): 모든 방의 장소 읽기, 다른 방 장소 고치기의 멤버 확인(계정 id), 본 장소 기록.
const rpc = vi.fn();
vi.mock("@/lib/db", () => ({ db: () => ({ from: fakeDb.from, rpc }) }));
import { tokenHash } from "@/lib/token";
import { GET as allPlaces } from "@/app/api/places/all/route";
import { GET as rooms } from "@/app/api/rooms/route";
import { GET as seenList, POST as markSeen } from "@/app/api/places/seen/route";
import { GET as readPlace, PATCH as patchPlace, DELETE as deletePlace } from "@/app/api/places/[id]/route";
import { POST as copy } from "@/app/api/places/copy/route";

const token = "c".repeat(64);
const ME = "aaaaaaaa-0000-4000-8000-000000000001", MINHO = "aaaaaaaa-0000-4000-8000-000000000002", OTHER = "aaaaaaaa-0000-4000-8000-000000000003";
const OURS = "bbbbbbbb-0000-4000-8000-000000000001", JEJU = "bbbbbbbb-0000-4000-8000-000000000002", STRANGER = "bbbbbbbb-0000-4000-8000-000000000003";
const P_OURS = "cccccccc-0000-4000-8000-000000000001", P_JEJU = "cccccccc-0000-4000-8000-000000000002", P_STRANGER = "cccccccc-0000-4000-8000-000000000003";
function req(path: string, method = "GET", body?: unknown, headers: Record<string, string> = {}) {
  return new Request(`http://localhost/api/${path}`, { method, headers: { cookie: `datemap_session=${token}`, origin: "http://localhost", "Content-Type": "application/json", ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
const p = <T,>(value: T) => ({ params: Promise.resolve(value) });

beforeEach(() => {
  reset(); rpc.mockReset();
  rpc.mockImplementation(async (name: string, params: Record<string, any>) => {
    if (name === "dm_list_folders") {
      const mine = tables.board_members.filter((m) => m.user_id === params.p_user);
      return { data: mine.map((m) => { const b = tables.boards.find((x) => x.id === m.board_id)!; return { id: b.id, name: b.name, color: b.color, role: m.role, member_name: m.member_name, member_count: tables.board_members.filter((x) => x.board_id === b.id).length, member_limit: 8, place_count: tables.places.filter((x) => x.board_id === b.id).length }; }), error: null };
    }
    if (name === "dm_patch_place") return { data: { ok: true, memo_version: 1, memo_changed: false }, error: null };
    if (name === "dm_delete_place") return { data: { ok: true, deleted_id: params.p_place }, error: null };
    if (name === "dm_copy_places") return { data: { to: params.p_to, folder: "내 장소", created: 1, merged: 0, place_ids: [] }, error: null };
    if (name === "dm_mark_seen") return { data: params.p_places.length, error: null };
    if (name === "dm_seen_places") return { data: [P_OURS, "not-a-uuid"], error: null };
    return fakeDb.rpc(name, params);
  });
  tables.access_sessions = [{ token_hash: tokenHash(token), board_id: OURS, purpose: "member", member_name: "유빈", remember: true, auth_version: 0, expires_at: "2030-01-01T00:00:00Z", user_id: ME }];
  tables.boards = [
    { id: OURS, name: "우리 데이트맵", color: "red", member_names: ["유빈", "민호"], auth_version: 0 },
    { id: JEJU, name: "제주 여행", color: "teal", member_names: ["유빈"], auth_version: 3 },
    { id: STRANGER, name: "남의 방", color: "navy", member_names: ["다른 사람"], auth_version: 0 },
  ];
  tables.board_members = [
    { board_id: OURS, user_id: ME, member_name: "유빈", role: "owner", joined_at: "2026-01-01" },
    { board_id: OURS, user_id: MINHO, member_name: "민호", role: "member", joined_at: "2026-01-02" },
    { board_id: JEJU, user_id: ME, member_name: "유빈", role: "member", joined_at: "2026-01-03" },
    { board_id: STRANGER, user_id: OTHER, member_name: "다른 사람", role: "owner", joined_at: "2026-01-04" },
  ];
  tables.places = [
    { id: P_OURS, board_id: OURS, kakao_place_id: "1", name: "어니언 성수", lat: 37.5, lng: 127, status: "wish", created_at: "2026-11-25T00:00:00Z" },
    { id: P_JEJU, board_id: JEJU, kakao_place_id: "1", name: "어니언 성수", lat: 37.5, lng: 127, status: "wish", created_at: "2026-11-24T00:00:00Z" },
    { id: P_STRANGER, board_id: STRANGER, kakao_place_id: "9", name: "남의 가게", lat: 37.5, lng: 127, status: "wish", created_at: "2026-11-24T00:00:00Z" },
  ];
  tables.place_saves = [
    { board_id: OURS, place_id: P_OURS, added_by: "민호옛이름", added_by_user_id: MINHO, added_at: "2026-11-25T00:00:00Z" },
    { board_id: JEJU, place_id: P_JEJU, added_by: "유빈", added_by_user_id: ME, added_at: "2026-11-24T00:00:00Z" },
    { board_id: STRANGER, place_id: P_STRANGER, added_by: "다른 사람", added_by_user_id: OTHER, added_at: "2026-11-24T00:00:00Z" },
  ];
  tables.collections = [{ id: "col1", board_id: OURS, name: "성수", color: "red", icon: "☕" }, { id: "col2", board_id: STRANGER, name: "x", color: "red", icon: "☕" }];
  tables.board_sync = [{ board_id: OURS, revision: "5" }, { board_id: JEJU, revision: "2" }, { board_id: STRANGER, revision: "7" }];
});

describe("전체 보기: 모든 방의 장소", () => {
  it("내가 멤버인 방의 장소만 방 id와 함께, 저장한 사람은 그 방의 지금 이름으로 준다", async () => {
    const res = await allPlaces(req("places/all"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.current).toBe(OURS);
    expect(body.places.map((x: any) => [x.id, x.board_id]).sort()).toEqual([[P_OURS, OURS], [P_JEJU, JEJU]].sort());
    expect(body.places.find((x: any) => x.id === P_OURS)).toMatchObject({ sharers: ["민호"], registrant: "민호", registrant_id: MINHO, sources: [], last_saved_at: "2026-11-25T00:00:00Z" });
    expect(JSON.stringify(body)).not.toContain("남의");
    expect(body.rooms.map((r: any) => [r.id, r.collection_count, r.member_ids, r.member_names])).toEqual([
      [OURS, 1, [ME, MINHO], ["유빈", "민호"]], [JEJU, 0, [ME], ["유빈"]],
    ]);
  });

  it("방 목록과 변경 번호가 같으면 304로 장소를 다시 읽지 않고, 어느 방이든 바뀌면 새로 준다", async () => {
    const first = await allPlaces(req("places/all")), etag = first.headers.get("etag")!;
    expect(etag).toMatch(/^"all1:/);
    const same = await allPlaces(req("places/all", "GET", undefined, { "if-none-match": etag }));
    expect(same.status).toBe(304);
    tables.board_sync[1].revision = "3";
    const changed = await allPlaces(req("places/all", "GET", undefined, { "if-none-match": etag }));
    expect(changed.status).toBe(200);
    expect(changed.headers.get("etag")).not.toBe(etag);
  });

  it("방 목록 API는 색·장소 수·모음 수·멤버와 이 기기가 연 방을 준다", async () => {
    const body = await (await rooms(req("rooms"))).json();
    expect(body.current).toBe(OURS);
    expect(body.rooms[0]).toMatchObject({ id: OURS, name: "우리 데이트맵", color: "red", member_count: 2, place_count: 1, collection_count: 1 });
  });

  it("로그인하지 않았으면 401", async () => {
    tables.access_sessions = [];
    for (const res of [await allPlaces(req("places/all")), await rooms(req("rooms")), await seenList(req("places/seen"))]) expect(res.status).toBe(401);
  });
});

describe("다른 방의 장소 고치기: ?room= + 계정 id로 멤버 확인", () => {
  it("멤버인 다른 방의 장소는 그 방으로 읽고 고치고 지운다(세션이 연 방의 인증 버전과 상관없이)", async () => {
    expect((await readPlace(req(`places/${P_JEJU}?room=${JEJU}`), p({ id: P_JEJU }))).status).toBe(200);
    expect((await patchPlace(req(`places/${P_JEJU}?room=${JEJU}`, "PATCH", { memo: "제주 메모", memo_version: 0 }), p({ id: P_JEJU }))).status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("dm_patch_place", expect.objectContaining({ p_board: JEJU, p_id: P_JEJU, p_who: "유빈" }));
    expect((await deletePlace(req(`places/${P_JEJU}?room=${JEJU}`, "DELETE"), p({ id: P_JEJU }))).status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("dm_delete_place", { p_user: ME, p_board: JEJU, p_place: P_JEJU });
  });

  it("room이 없으면 이 기기가 연 방만 본다(예전 동작)", async () => {
    const res = await readPlace(req(`places/${P_JEJU}`), p({ id: P_JEJU }));
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe("PLACE_NOT_FOUND");
  });

  it("멤버가 아닌 방·없는 방은 로그아웃(401)이 아니라 404로 막고 DB 함수를 부르지 않는다", async () => {
    for (const room of [STRANGER, "bbbbbbbb-0000-4000-8000-00000000ffff"]) {
      const res = await patchPlace(req(`places/${P_STRANGER}?room=${room}`, "PATCH", { memo: "x", memo_version: 0 }), p({ id: P_STRANGER }));
      expect(res.status).toBe(404);
      expect((await res.json()).message).toBe("방을 찾을 수 없어요.");
    }
    expect((await deletePlace(req(`places/${P_STRANGER}?room=${STRANGER}`, "DELETE"), p({ id: P_STRANGER }))).status).toBe(404);
    expect(rpc).not.toHaveBeenCalledWith("dm_patch_place", expect.anything());
    expect(rpc).not.toHaveBeenCalledWith("dm_delete_place", expect.anything());
  });

  it("형식이 틀린 room은 무시하고 이 기기가 연 방을 쓴다", async () => {
    expect((await patchPlace(req(`places/${P_OURS}?room=../x`, "PATCH", { memo: "x", memo_version: 0 }), p({ id: P_OURS }))).status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("dm_patch_place", expect.objectContaining({ p_board: OURS }));
  });

  it("다른 방에 담기: from 방의 멤버일 때만 그 방에서 담는다", async () => {
    expect((await copy(req("places/copy", "POST", { to: OURS, ids: [P_JEJU], from: JEJU }))).status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("dm_copy_places", { p_user: ME, p_from: JEJU, p_to: OURS, p_ids: [P_JEJU] });
    expect((await copy(req("places/copy", "POST", { to: OURS, ids: [P_STRANGER], from: STRANGER }))).status).toBe(404);
    expect((await copy(req("places/copy", "POST", { to: JEJU, ids: [P_OURS] }))).status).toBe(200);
    expect(rpc).toHaveBeenLastCalledWith("dm_copy_places", { p_user: ME, p_from: OURS, p_to: JEJU, p_ids: [P_OURS] });
  });
});

describe("본 장소 기록(020)", () => {
  it("본 장소 id를 계정으로 적고, 형식이 틀린 id는 거절한다", async () => {
    expect(await (await markSeen(req("places/seen", "POST", { ids: [P_OURS, P_OURS, P_JEJU] }))).json()).toEqual({ ok: true, count: 2 });
    expect(rpc).toHaveBeenCalledWith("dm_mark_seen", { p_user: ME, p_places: [P_OURS, P_JEJU] });
    for (const ids of [[], ["x"], Array.from({ length: 501 }, (_, i) => `cccccccc-0000-4000-8000-${String(i).padStart(12, "0")}`)]) {
      expect((await markSeen(req("places/seen", "POST", { ids }))).status).toBe(400);
    }
  });

  it("최근 본 장소 id만 돌려주고, 020이 없는 DB에서는 빈 목록·0으로 답한다(화면은 기기 기록으로 동작)", async () => {
    expect(await (await seenList(req("places/seen"))).json()).toEqual({ ids: [P_OURS] });
    rpc.mockImplementation(async () => ({ data: null, error: { code: "PGRST202", message: "function not found" } }));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await (await seenList(req("places/seen"))).json()).toEqual({ ids: [] });
    expect(await (await markSeen(req("places/seen", "POST", { ids: [P_OURS] }))).json()).toEqual({ ok: false, count: 0 });
    error.mockRestore();
  });

  it("다른 사이트에서 보낸 기록은 막는다", async () => {
    const res = await markSeen(new Request("http://localhost/api/places/seen", { method: "POST", headers: { cookie: `datemap_session=${token}`, origin: "https://evil.example", "Content-Type": "application/json" }, body: JSON.stringify({ ids: [P_OURS] }) }));
    expect(res.status).toBe(403);
  });
});
