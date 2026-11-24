import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, reset, tables } from "./fakeDb";
import { tokenHash } from "@/lib/token";
vi.mock("@/lib/db", () => ({ db: () => fakeDb }));
vi.mock("next/server", async (original) => ({ ...await original<typeof import("next/server")>(), after: vi.fn() }));
import { GET as listTrash } from "@/app/api/trash/route";
import { POST as restore, DELETE as purge } from "@/app/api/trash/[id]/route";
import { DELETE } from "@/app/api/places/[id]/route";
import { POST as copy } from "@/app/api/places/copy/route";
import { canDeletePlace } from "@/lib/place-view";
import { placeNotification } from "@/lib/push-server";
const token = "a".repeat(64);
const log = "44444444-4444-4444-8444-444444444444", room = "22222222-2222-4222-8222-222222222222", p1 = "33333333-3333-4333-8333-333333333333";
const headers = (origin = "http://localhost") => ({ origin, cookie: `datemap_session=${token}`, "Content-Type": "application/json" });
const request = (authenticated = true, origin = "http://localhost") => new Request("http://localhost/api/places/p1", { method: "DELETE", headers: authenticated ? headers(origin) : { origin } });
const params = (id: string) => ({ params: Promise.resolve({ id }) });
beforeEach(() => {
  reset(); vi.restoreAllMocks();
  tables.boards = [{ id: "b1", name: "지도", member_names: ["우리", "서로"], auth_version: 1 }];
  tables.access_sessions = [{ token_hash: tokenHash(token), board_id: "b1", purpose: "member", member_name: "우리", auth_version: 1, expires_at: "2030-01-01" }];
});

describe("삭제 권한(처음 등록한 사람)", () => {
  it("화면 판단: 등록한 사람만, 등록한 사람이 방에 없으면 누구나", () => {
    expect(canDeletePlace({ registrant: "우리" }, "우리", ["우리", "서로"])).toBe(true);
    expect(canDeletePlace({ registrant: "서로" }, "우리", ["우리", "서로"])).toBe(false);
    expect(canDeletePlace({ registrant: "떠난 사람" }, "우리", ["우리", "서로"])).toBe(true);
    expect(canDeletePlace({ registrant: null }, "우리", ["우리"])).toBe(true);
  });
  it("서버: 지금 방·내 계정으로 dm_delete_place를 부르고, 권한 안내는 한국어로 전한다", async () => {
    const rpc = vi.spyOn(fakeDb, "rpc").mockResolvedValueOnce({ data: { ok: true, deleted_id: "p1", log_id: log }, error: null });
    const res = await DELETE(request(), params("p1"));
    expect(res.status).toBe(200); expect(await res.json()).toEqual({ ok: true, deleted_id: "p1", already_deleted: false });
    expect(rpc).toHaveBeenCalledWith("dm_delete_place", { p_user: "u:우리", p_board: "b1", p_place: "p1" });
    rpc.mockResolvedValueOnce({ data: null, error: { message: "서로님이 등록한 장소라 지울 수 없어요.", code: "P0001" } } as never);
    const denied = await DELETE(request(), params("p1"));
    expect(denied.status).toBe(409); expect((await denied.json()).message).toBe("서로님이 등록한 장소라 지울 수 없어요.");
    rpc.mockResolvedValueOnce({ data: null, error: { message: "relation missing", code: "42P01" } } as never);
    const broken = await DELETE(request(), params("p1"));
    expect(broken.status).toBe(500); expect(await broken.text()).not.toContain("relation");
  });
  it("인증 없음·외부 Origin은 삭제 전에 거절", async () => {
    const rpc = vi.spyOn(fakeDb, "rpc");
    expect((await DELETE(request(false), params("p1"))).status).toBe(401);
    expect((await DELETE(request(true, "https://elsewhere.example"), params("p1"))).status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("나만 보는 삭제 기록", () => {
  it("내 기록만 모든 방에서 보여주고, 나간 방·없어진 방은 되돌릴 수 없다고 표시", async () => {
    tables.place_trash_log = [
      { id: log, user_id: "u:우리", board_id: "b1", board_name: "지도", place: { name: "고코", address: "서울", memo: "창가" }, deleted_at: "2026-11-25T01:00:00Z" },
      { id: "l2", user_id: "u:우리", board_id: null, board_name: "없어진 방", place: { name: "카페" }, deleted_at: "2026-11-24T01:00:00Z" },
      { id: "l3", user_id: "u:서로", board_id: "b1", board_name: "지도", place: { name: "남의 기록" }, deleted_at: "2026-11-24T01:00:00Z" },
    ];
    const res = await listTrash(new Request("http://localhost/api/trash", { headers: headers() }));
    const { places } = await res.json();
    expect(places.map((p: { id: string }) => p.id)).toEqual([log, "l2"]);
    expect(places[0]).toMatchObject({ name: "고코", board_name: "지도", restorable: true, current: true });
    expect(places[1]).toMatchObject({ restorable: false });
  });
  it("되돌리기: 지금 방이면 지도에 바로 보일 장소를 함께, 다른 방이면 결과만", async () => {
    const rpc = vi.spyOn(fakeDb, "rpc").mockResolvedValueOnce({ data: { ok: true, board_id: room, board_name: "친구들", place_id: p1, merged: false }, error: null });
    const other = await (await restore(new Request(`http://localhost/api/trash/${log}`, { method: "POST", headers: headers(), body: "{}" }), params(log))).json();
    expect(other).toEqual({ ok: true, board_id: room, board_name: "친구들", merged: false, place_url: `/?place=${p1}` });
    expect(rpc).toHaveBeenCalledWith("dm_restore_place", { p_user: "u:우리", p_log: log });
    rpc.mockResolvedValueOnce({ data: { code: "LOG_NOT_FOUND" }, error: null });
    expect((await restore(new Request(`http://localhost/api/trash/${log}`, { method: "POST", headers: headers(), body: "{}" }), params(log))).status).toBe(404);
    rpc.mockResolvedValueOnce({ data: null, error: { message: "방이 없어졌거나 나간 방이라 복구할 수 없어요.", code: "P0001" } } as never);
    const gone = await restore(new Request(`http://localhost/api/trash/${log}`, { method: "POST", headers: headers(), body: "{}" }), params(log));
    expect(gone.status).toBe(409); expect((await gone.json()).message).toContain("복구할 수 없어요");
  });
  it("기록에서 지우기와 잘못된 요청", async () => {
    const rpc = vi.spyOn(fakeDb, "rpc").mockResolvedValueOnce({ data: { ok: true, purged: true }, error: null });
    expect((await purge(new Request(`http://localhost/api/trash/${log}`, { method: "DELETE", headers: headers(), body: "{}" }), params(log))).status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("dm_purge_trash_log", { p_user: "u:우리", p_log: log });
    expect((await purge(new Request("http://localhost/api/trash/x", { method: "DELETE", headers: headers(), body: "{}" }), params("x"))).status).toBe(404);
    expect((await purge(new Request(`http://localhost/api/trash/${log}`, { method: "DELETE", headers: headers("https://evil.test"), body: "{}" }), params(log))).status).toBe(403);
  });
});

describe("다른 방에 담기 API", () => {
  const req = (body: unknown, origin = "http://localhost") => new Request("http://localhost/api/places/copy", { method: "POST", headers: headers(origin), body: JSON.stringify(body) });
  it("지금 방에서 고른 방으로 복사하고 결과를 돌려준다(옮기기 없음)", async () => {
    const rpc = vi.spyOn(fakeDb, "rpc").mockResolvedValueOnce({ data: { to: room, folder: "내 장소", created: 1, merged: 0, place_ids: ["n1"] }, error: null });
    const res = await copy(req({ to: room, ids: [p1, p1], mode: "move" }));
    expect(res.status).toBe(200); expect((await res.json()).folder).toBe("내 장소");
    expect(rpc).toHaveBeenCalledWith("dm_copy_places", { p_user: "u:우리", p_from: "b1", p_to: room, p_ids: [p1] });
  });
  it("잘못된 입력·외부 요청은 거절하고, DB 안내는 한국어로 전한다", async () => {
    const rpc = vi.spyOn(fakeDb, "rpc");
    expect((await copy(req({ to: "x", ids: [p1] }))).status).toBe(400);
    expect((await copy(req({ to: room, ids: [] }))).status).toBe(400);
    expect((await copy(req({ to: room, ids: [p1] }, "https://evil.test"))).status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
    rpc.mockResolvedValueOnce({ data: null, error: { message: "참여한 방 사이에서만 담을 수 있어요.", code: "P0001" } } as never);
    expect((await (await copy(req({ to: room, ids: [p1] }))).json()).message).toBe("참여한 방 사이에서만 담을 수 있어요.");
  });
});

describe("폴더별 알림 내용", () => {
  it("폴더 이름을 제목에 붙이고 누르면 그 폴더의 장소로 간다", () => {
    expect(placeNotification({ event_id: "e", added_by: "서로", place_id: p1, place_name: "카페", event_kind: "place_added", folder_id: room, folder_name: "친구들" }))
      .toMatchObject({ title: "[친구들] 서로님이 새 장소를 담았어요", url: `/?place=${p1}&folder=${room}` });
  });
});
