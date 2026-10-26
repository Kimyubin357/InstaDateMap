import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, failNext, reset, tables } from "./fakeDb";
import { tokenHash } from "@/lib/pin";

vi.mock("@/lib/db", () => ({ db: () => fakeDb }));
vi.mock("@/lib/push-server", () => ({ schedulePlacePushes: vi.fn() }));
import { schedulePlacePushes } from "@/lib/push-server";
import { DELETE, GET, PATCH } from "@/app/api/places/[id]/route";

const params = (id = "p1") => ({ params: Promise.resolve({ id }) });
const request = (body: unknown, authenticated = true, origin = "http://localhost") => new Request("http://localhost/api/places/p1", {
  method: "PATCH",
  headers: { origin, "Content-Type": "application/json", ...(authenticated ? { cookie: `datemap_session=${"a".repeat(64)}` } : {}) },
  body: JSON.stringify({ memo_version: 0, ...(body as object) }),
});
const readRequest = (authenticated = true) => new Request("http://localhost/api/places/p1", {
  headers: authenticated ? { cookie: `datemap_session=${"a".repeat(64)}` } : {},
});

beforeEach(() => {
  reset(); vi.clearAllMocks();
  tables.boards = [{ id: "b1", name: "지도", member_names: ["유빈", "수민"], auth_version: 1 }];
  tables.access_sessions = [{ token_hash: tokenHash("a".repeat(64)), board_id: "b1", purpose: "member", member_name: "유빈", auth_version: 1, expires_at: "2030-01-01" }];
  tables.places = [
    { id: "p1", board_id: "b1", status: "wish", memo: "기존 메모" },
    { id: "p2", board_id: "b2", status: "visited", memo: "다른 보드 메모" },
  ];
});

describe("장소 수정 결과 확인", () => {
  it.each([{ status: "again" }, { memo: "같이 가고 싶은 곳" }])("실제로 수정한 장소만 성공으로 응답: %j", async (patch) => {
    const response = await PATCH(request(patch), params());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ ok: true });
    expect(tables.places[0]).toMatchObject(patch);
    expect(tables.places[1]).toMatchObject({ status: "visited", memo: "다른 보드 메모" });
  });

  it.each([{ status: "visited" }, { memo: "삭제 이후 쓰던 메모" }])("상대방이 삭제한 뒤 오래된 화면에서 수정하면 성공하지 않음: %j", async (patch) => {
    const deletion = new Request("http://localhost/api/places/p1", {
      method: "DELETE", headers: { origin: "http://localhost", cookie: `datemap_session=${"a".repeat(64)}` },
    });
    expect((await DELETE(deletion, params())).status).toBe(200);
    const response = await PATCH(request(patch), params());
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ code: "PLACE_NOT_FOUND", message: "이미 삭제된 장소예요." });
    expect(tables.places.filter((place) => !place.deleted_at).map((place) => place.id)).toEqual(["p2"]);
  });

  it("다른 보드의 장소도 해당 보드 안에서는 없는 장소로 처리하고 수정하지 않음", async () => {
    const before = structuredClone(tables.places);
    const response = await PATCH(request({ memo: "변경 시도" }), params("p2"));
    expect(response.status).toBe(404);
    expect((await response.json()).code).toBe("PLACE_NOT_FOUND");
    expect(tables.places).toEqual(before);
  });

  it("DB 오류를 삭제된 장소나 성공으로 오인하지 않음", async () => {
    failNext("places", "update");
    const response = await PATCH(request({ memo: "저장 시도" }), params());
    expect(response.status).toBe(500);
    // Internal DB messages stay in server logs, not in the response.
    expect(await response.json()).toEqual({ message: "장소를 수정하지 못했어요. 다시 시도해 주세요." });
    expect(tables.places[0].memo).toBe("기존 메모");
  });

  it("인증 없음·외부 Origin·이름 미선택은 수정 전에 거절", async () => {
    expect((await PATCH(request({ status: "visited" }, false), params())).status).toBe(401);
    expect((await PATCH(request({ status: "visited" }, true, "https://elsewhere.example"), params())).status).toBe(403);
    tables.access_sessions[0].member_name = null;
    expect((await PATCH(request({ status: "visited" }), params())).status).toBe(409);
    expect(tables.places[0].status).toBe("wish");
  });
});

describe("응답 유실 뒤 장소 최신 내용 확인", () => {
  it("현재 보드의 상태와 메모만 캐시 없이 읽음", async () => {
    await PATCH(request({ status: "again", memo: "실제로 저장된 메모" }), params());
    const response = await GET(readRequest(), params());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ place: { id: "p1", status: "again", memo: "실제로 저장된 메모" } });
  });

  it.each(["missing", "p2"])("없거나 다른 보드인 장소를 읽을 수 없음: %s", async (id) => {
    const response = await GET(readRequest(), params(id));
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ code: "PLACE_NOT_FOUND", message: "이미 삭제된 장소예요." });
  });

  it("인증과 기기 사용자 선택을 확인", async () => {
    const response = await GET(readRequest(false), params());
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    tables.access_sessions[0].member_name = null;
    expect((await GET(readRequest(), params())).status).toBe(409);
  });

  it("DB 조회 장애는 삭제로 판단하지 않음", async () => {
    failNext("places", "select");
    const response = await GET(readRequest(), params());
    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect((await response.json()).code).toBeUndefined();
    expect(tables.places).toHaveLength(2);
  });
});

 it("성공한 메모 변경 직후에만 발송을 예약", async () => {
   await PATCH(request({ memo: "새 메모" }), params());
   expect(schedulePlacePushes).toHaveBeenCalledTimes(1);
   expect(schedulePlacePushes).toHaveBeenCalledWith("b1");
   vi.mocked(schedulePlacePushes).mockClear();
   await PATCH(request({ memo: "새 메모", memo_version: 1 }), params());
   await PATCH(request({ memo: "충돌", memo_version: 0 }), params());
   await PATCH(request({ status: "visited" }), params());
   failNext("places", "update");
   await PATCH(request({ memo: "실패", memo_version: 2 }), params());
   expect(schedulePlacePushes).not.toHaveBeenCalled();
 });
