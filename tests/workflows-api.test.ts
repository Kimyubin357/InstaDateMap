import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, reset, tables } from "./fakeDb";
import { tokenHash } from "@/lib/pin";
vi.mock("@/lib/db", () => ({ db: () => fakeDb }));
vi.mock("@/lib/kakao", () => ({ keywordSearch: vi.fn(async () => [{ kakao_place_id: "manual", name: "서버가 찾은 식당", address: "실제 주소", lat: 37, lng: 127, category: "식당", kakao_url: "" }]), keywordSearchPage: vi.fn(async (_query: string, page: number) => ({ page, is_end: true, total_count: 9, places: [{ kakao_place_id: "page-two", name: "서버의 두 번째 페이지 식당", address: "진짜 주소", lat: 37, lng: 127, category: "식당", kakao_url: "" }] })) }));
import { keywordSearch, keywordSearchPage } from "@/lib/kakao";
import { POST as confirm } from "@/app/api/sources/[id]/confirm/route";
import { POST as session } from "@/app/api/sources/[id]/session/route";
import { PATCH } from "@/app/api/places/[id]/route";
import { GET as list, POST as directSave } from "@/app/api/places/route";
const work = "10000000-0000-4000-8000-000000000001", version = "20000000-0000-4000-8000-000000000001";
const owner = `${tokenHash("a".repeat(64))}:${work}`;
const place = { kakao_place_id: "original", name: "어부의딸", address: "서울", lat: 37, lng: 127, category: "식당", kakao_url: "" };
const params = { params: Promise.resolve({ id: "s1" }) };
const request = (body: object, method = "POST", origin = "http://localhost") => new Request("http://localhost/api/test", { method, headers: { origin, cookie: `datemap_session=${"a".repeat(64)}`, "content-type": "application/json" }, body: JSON.stringify({ work_id: work, version, ...body }) });
beforeEach(() => {
  reset(); vi.clearAllMocks();
  tables.boards = [{ id: "b1", name: "테스트", member_names: ["유빈", "수민"], auth_version: 1 }];
  tables.access_sessions = [{ token_hash: tokenHash("a".repeat(64)), board_id: "b1", member_name: "유빈", purpose: "member", auth_version: 1, expires_at: "2030-01-01" }];
  tables.sources = [{ id: "s1", board_id: "b1", status: "pending_confirm", analysis_version: version, work_owner: owner, work_until: new Date(Date.now() + 90000).toISOString() }];
  tables.extractions = [{ id: "e1", source_id: "s1", candidates: [place] }];
});
describe("서버가 확인 저장의 장소 정보를 결정", () => {
  it("후보 번호만 받아 원래 이름·주소·좌표로 저장, 위조된 객체는 무시", async () => {
    const response = await confirm(request({ selections: [{ extraction_id: "e1", include: true, place_id: "original", place: { ...place, name: "가짜", lat: 0, address: "가짜" } }] }), params);
    expect(response.status).toBe(200); expect(tables.places[0]).toMatchObject(place); expect(keywordSearch).not.toHaveBeenCalled();
  });
  it("번호 없는 예전 객체와 후보에 없는 번호는 쓰기 전에 거절", async () => {
    for (const selection of [{ place }, { place_id: "fake" }]) {
      const response = await confirm(request({ selections: [{ extraction_id: "e1", include: true, ...selection }] }), params);
      expect(response.status).toBe(400); expect(tables.places ?? []).toHaveLength(0); expect(tables.extractions[0].excluded).toBeUndefined();
    }
  });
  it("직접 검색 결과와 직접 대체 후보는 카카오를 다시 조회", async () => {
    const response = await confirm(request({ selections: [{ extraction_id: "e1", include: true, place_id: "manual", query: "식당" }] }), params);
    expect(response.status).toBe(200); expect(tables.places[0].name).toBe("서버가 찾은 식당"); expect(keywordSearch).toHaveBeenCalledWith("식당");
  });
  it("후보 없는 직접 저장에서도 위조 정보를 사용하지 않음", async () => {
    const response = await confirm(request({ selections: [], direct: { place_id: "manual", query: "식당", name: "가짜", lat: 0 } }), params);
    expect(response.status).toBe(200); expect(tables.places[0]).toMatchObject({ name: "서버가 찾은 식당", lat: 37 });
  });
  it("갱신된 세대와 다른 소유자의 확인 저장을 거절", async () => {
    expect((await confirm(request({ version: "old", selections: [] }), params)).status).toBe(409);
    tables.sources[0].work_owner = "other";
    expect((await confirm(request({ selections: [] }), params)).status).toBe(409);
    expect(tables.sources[0].status).toBe("pending_confirm");
  });
  it("카카오 조회 중 재분석이 시작되어도 오래된 결과를 커밋하지 않음", async () => {
    vi.mocked(keywordSearch).mockImplementationOnce(async () => { tables.sources[0].analysis_version = "new"; return [place]; });
    const response = await confirm(request({ selections: [], direct: { place_id: "original", query: "식당" } }), params);
    expect(response.status).toBe(409); expect(tables.places ?? []).toHaveLength(0);
  });
});
describe("대기 링크 복구와 제외", () => {
  it("오래된 processing은 지도 목록 조회에서 대기함으로 복구", async () => {
    Object.assign(tables.sources[0], { status: "processing", work_until: "2020-01-01", url: "https://www.instagram.com/p/ABC/", shared_by: "유빈" });
    const result = await list(new Request("http://localhost/api/places", { headers: { cookie: `datemap_session=${"a".repeat(64)}` } }));
    expect(result.status).toBe(200); expect((await result.json()).pending[0]).toMatchObject({ status: "needs_review", recovery_reason: "interrupted" });
  });
  it("후보가 없어도 제외 가능하며 저장 장소는 유지", async () => {
    tables.extractions = []; tables.places = [{ id: "p1", memo: "남겨둘 메모" }];
    expect((await session(request({ action: "dismiss" }), params)).status).toBe(200);
    expect(tables.sources[0].status).toBe("dismissed"); expect(tables.places[0].memo).toBe("남겨둘 메모");
  });
  it("외부 사이트와 다른 보드의 제외 요청 차단", async () => {
    expect((await session(request({ action: "dismiss" }, "POST", "https://elsewhere.example"), params)).status).toBe(403);
    tables.sources[0].board_id = "other";
    expect((await session(request({ action: "dismiss" }), params)).status).toBe(404);
  });
  it("메모 충돌은 인증 오류와 구별되고 최신 내용·작성자를 반환", async () => {
    tables.places = [{ id: "p1", board_id: "b1", memo: "토요일 저녁", memo_version: 1, memo_updated_by: "유빈" }];
    const response = await PATCH(request({ memo: "주차 가능", memo_version: 0 }, "PATCH"), { params: Promise.resolve({ id: "p1" }) });
    expect(response.status).toBe(409); expect(await response.json()).toMatchObject({ code: "MEMO_CONFLICT", memo: "토요일 저녁", memo_version: 1, memo_updated_by: "유빈" });
    expect(tables.places[0].memo).toBe("토요일 저녁");
  });
});

it("direct saves from a later search page validate the provider response instead of the client object", async () => {
  const response = await confirm(request({ selections: [], direct: { query: "식당", place_id: "page-two", page: 2, name: "위조", lat: 0 } }), params);
  expect(response.status).toBe(200); expect(keywordSearchPage).toHaveBeenCalledWith("식당", 2);
  expect(tables.places[0]).toMatchObject({ name: "서버의 두 번째 페이지 식당", lat: 37 });
});
it("replacement candidates from later pages are also verified", async () => {
  const response = await confirm(request({ selections: [{ extraction_id: "e1", include: true, place_id: "page-two", query: "식당", page: 2 }] }), params);
  expect(response.status).toBe(200); expect(tables.places[0].kakao_place_id).toBe("page-two");
});
it("pending names and dates are returned only for this board's pending sources", async () => {
  tables.sources[0].shared_at = "2026-10-24T00:00:00Z"; tables.sources[0].shared_by = "유빈";
  tables.sources.push({ id: "other", board_id: "b2", status: "needs_review" });
  Object.assign(tables.extractions[0], { raw_name: "어부의딸", branch: "성수점" });
  tables.extractions.push({ source_id: "other", raw_name: "다른 보드의 장소" });
  const response = await list(new Request("http://localhost/api/places", { headers: { cookie: `datemap_session=${"a".repeat(64)}` } }));
  expect((await response.json()).pending).toMatchObject([{ id: "s1", place_names: ["어부의딸 성수점"], shared_at: "2026-10-24T00:00:00Z" }]);
});

it("standalone direct search can save an item from page two", async () => {
  const response = await directSave(request({ query: "식당", place_id: "page-two", page: 2, name: "위조" }));
  expect(response.status).toBe(200); expect(tables.places[0]).toMatchObject({ kakao_place_id: "page-two", name: "서버의 두 번째 페이지 식당" });
});
