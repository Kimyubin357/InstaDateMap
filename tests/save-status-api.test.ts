import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, failNext, reset, tables } from "./fakeDb";
import { tokenHash } from "@/lib/pin";

vi.mock("@/lib/db", () => ({ db: () => fakeDb }));
import { GET } from "@/app/api/save-status/route";

const sourceId = "11111111-1111-1111-1111-111111111111";
const sourceUrl = "https://www.instagram.com/reel/ABC/";
const req = (query: string, authenticated = true) => new Request(`http://localhost/api/save-status?${query}`, { headers: authenticated ? { cookie: `datemap_session=${"a".repeat(64)}` } : {} });
function seed(status = "done") {
  tables.sources = [{ id: sourceId, board_id: "b1", url: sourceUrl, media_type: "reel", status }];
  tables.extractions = [{ id: "e1", source_id: sourceId, excluded: false }, { id: "e2", source_id: sourceId, excluded: true }];
  tables.places = [{ id: "p1", board_id: "b1", kakao_place_id: "123", name: "식당", lat: 37, lng: 127, status: "wish", created_at: "2026-01-01" }];
  tables.place_saves = [{ board_id: "b1", place_id: "p1", added_by: "유빈", added_at: "2026-01-01" }];
  tables.source_places = [{ source_id: sourceId, place_id: "p1", extraction_id: "e1", added_by: "유빈" }];
}
beforeEach(() => {
  reset();
  tables.boards = [{ id: "b1", name: "우리 지도", member_names: ["유빈", "수민"], auth_version: 1 }];
  tables.access_sessions = [{ token_hash: tokenHash("a".repeat(64)), board_id: "b1", purpose: "member", member_name: "유빈", auth_version: 1, expires_at: "2030-01-01" }];
  tables.board_sync = [{ board_id: "b1", revision: "4" }];
});

describe("응답을 놓친 저장 결과 읽기", () => {
  it("PIN과 기기 이름이 필요하고 오류 응답도 캐시하지 않음", async () => {
    const denied = await GET(req("kakao_place_id=123", false));
    expect(denied.status).toBe(401); expect(denied.headers.get("cache-control")).toBe("no-store");
    tables.access_sessions[0].member_name = null;
    expect((await GET(req("kakao_place_id=123"))).status).toBe(409);
  });
  it("정규화한 링크의 완료 상태와 내 선택 연결을 읽으며 저장·알림 기록은 바꾸지 않음", async () => {
    seed(); tables.push_deliveries = []; tables.place_push_events = [];
    const before = structuredClone(tables);
    const res = await GET(req(`url=${encodeURIComponent("공유 https://www.instagram.com/reel/ABC/?igsh=tracking")}`));
    expect(res.status).toBe(200); expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toMatchObject({ result: { status: "saved", source_id: sourceId, place_url: "/?place=p1", saved_place: { place: { id: "p1" } } },
      source: { id: sourceId, status: "done" }, selections: [{ id: "e1", excluded: false }, { id: "e2", excluded: true }], linked: [{ kakao_place_id: "123", extraction_id: "e1" }] });
    expect(tables).toEqual(before);
  });
  it("직접 저장은 내 저장자 기록이 있어야 확인되고 다른 사람의 저장만 있으면 성공으로 안내하지 않음", async () => {
    seed();
    expect((await (await GET(req("kakao_place_id=123"))).json()).result).toMatchObject({ status: "saved", place_url: "/?place=p1" });
    tables.place_saves[0].added_by = "수민";
    expect((await (await GET(req("kakao_place_id=123"))).json()).result).toBeNull();
    tables.place_saves[0].added_by = "유빈"; tables.place_saves[0].board_id = "other";
    expect((await (await GET(req("kakao_place_id=123"))).json()).result).toBeNull();
  });
  it("다른 보드의 링크·장소를 노출하지 않음", async () => {
    seed(); tables.sources[0].board_id = "other"; tables.places[0].board_id = "other";
    for (const query of [`source_id=${sourceId}`, `url=${encodeURIComponent(sourceUrl)}`, "kakao_place_id=123"]) {
      expect(await (await GET(req(query))).json()).toEqual({ result: null, source: null, selections: [], linked: [] });
    }
  });
  it("진행 중·아직 없는 링크는 성공이나 실패를 단정하지 않음", async () => {
    const absent = await GET(req(`source_id=${sourceId}`));
    expect((await absent.json()).result).toBeNull();
    seed("processing");
    expect(await (await GET(req(`source_id=${sourceId}`))).json()).toMatchObject({ result: null, source: { status: "processing" } });
  });
  it.each(["pending_confirm", "needs_review", "needs_caption"])("%s 링크는 해당 확인 화면으로 이어짐", async (status) => {
    seed(status);
    expect((await (await GET(req(`source_id=${sourceId}`))).json()).result).toMatchObject({ status: status === "pending_confirm" ? "confirm" : status, confirm_url: `/confirm/${sourceId}` });
  });
  it("완료 링크도 내 연결이 없거나 장소가 삭제되면 저장됐다고 안내하지 않음", async () => {
    seed(); tables.source_places[0].added_by = "수민";
    expect(await (await GET(req(`source_id=${sourceId}`))).json()).toMatchObject({ result: null, source: { status: "done" }, linked: [] });
    tables.source_places[0].added_by = "유빈"; tables.places = [];
    expect(await (await GET(req(`source_id=${sourceId}`))).json()).toMatchObject({ result: null, linked: [] });
  });
  it("다른 사람의 추가 지점은 내 확인 결과에 포함하지 않음", async () => {
    seed(); tables.places.push({ id: "p2", board_id: "b1", kakao_place_id: "456" });
    tables.source_places.push({ source_id: sourceId, place_id: "p2", extraction_id: "e2", added_by: "수민" });
    expect((await (await GET(req(`source_id=${sourceId}`))).json()).linked).toEqual([{ kakao_place_id: "123", extraction_id: "e1" }]);
  });
  it.each(["sources", "extractions", "source_places", "places"])("%s 조회 오류를 성공으로 처리하지 않음", async (table) => {
    seed(); failNext(table, "select");
    const res = await GET(req(`source_id=${sourceId}`));
    expect(res.status).toBe(500); expect((await res.json()).message).toContain("저장 여부");
  });
  it("직접 저장자 조회 장애와 잘못된 요청을 구분함", async () => {
    seed(); failNext("place_saves", "select"); expect((await GET(req("kakao_place_id=123"))).status).toBe(500);
    for (const query of ["", "kakao_place_id=", `source_id=${sourceId}&kakao_place_id=123`, "source_id=invalid", "url=https://example.com"]) {
      expect((await GET(req(query))).status).toBe(400);
    }
  });
});
