import { afterEach, describe, expect, it, vi } from "vitest";
import { PlaceSearch, unifiedResults } from "@/lib/place-search";
import type { PlaceView } from "@/lib/place-view";
import type { KakaoPlace } from "@/lib/types";
const candidate = (id: string): KakaoPlace => ({ kakao_place_id: id, name: "행궁동 식당", address: "경기 수원시", category: "음식점", lat: 37, lng: 127, kakao_url: "" });
const place = (id: string, patch: Partial<PlaceView> = {}): PlaceView => ({ ...candidate(id), id, status: "meh", memo: "창가", sharers: [], sources: [], created_at: "", last_saved_at: "", ...patch });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { resolve, promise }; }
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
describe("통합 검색 결과", () => {
  it("네 가지 상태 전체에서 이름·주소·메모 검색하고 보관함 전체 ID로 중복 제거", () => {
    const result = unifiedResults([place("1"), place("2", { name: "다른 이름", memo: "조용한 곳" })], "창가", [candidate("1"), candidate("2"), candidate("3"), candidate("3")]);
    expect(result.saved.map((p) => p.id)).toEqual(["1"]); expect(result.fresh.map((p) => p.kakao_place_id)).toEqual(["3"]);
    expect(unifiedResults([place("1")], "수원", []).saved).toHaveLength(1);
    expect(unifiedResults([place("1")], "행궁동", []).saved).toHaveLength(1);
  });
  it("카카오 ID 없는 기존 장소도 이름으로 검색", () => {
    expect(unifiedResults([place("1", { kakao_place_id: null })], "식당", []).saved).toHaveLength(1);
  });
  it("업종만 일치한 카카오 결과는 저장된 장소 검색에 추가하지 않음", () => {
    const saved = place("1", { name: "온기식당", address: "서울 중구 세종대로 1", memo: "창가 자리", category: "한식" });
    const result = unifiedResults([saved], "한식", [candidate("1"), candidate("new")]);
    expect(result.saved).toEqual([]);
    expect(result.fresh.map((p) => p.kakao_place_id)).toEqual(["new"]);
  });
  it.each(["온기식당", "세종대로", "창가 자리"])("상호명·주소·메모 %s로 찾은 저장 장소는 한 번만 표시", (query) => {
    const saved = place("1", { name: "온기식당", address: "서울 중구 세종대로 1", memo: "창가 자리", category: "한식" });
    const result = unifiedResults([saved], query, [candidate("1")]);
    expect(result.saved).toEqual([saved]);
    expect(result.fresh).toEqual([]);
  });
  it("업종과 같은 단어라도 저장된 상호명이나 메모에 있으면 검색", () => {
    const saved = place("1", { name: "온기식당", category: "음식점", memo: "한식 먹고 싶을 때" });
    expect(unifiedResults([saved], "한식", []).saved).toEqual([saved]);
  });
});
describe("검색 요청과 복귀", () => {
  it("두 글자부터 350ms 묶어서 검색하고 지우면 대기 요청 취소", async () => {
    vi.useFakeTimers(); const fetcher = vi.fn(async () => Response.json({ places: [] })); const search = new PlaceSearch(fetcher as typeof fetch);
    search.setQuery("행"); await vi.advanceTimersByTimeAsync(400); expect(fetcher).not.toHaveBeenCalled();
    search.setQuery("행궁"); await vi.advanceTimersByTimeAsync(349); expect(fetcher).not.toHaveBeenCalled();
    search.setQuery("행궁동"); await vi.advanceTimersByTimeAsync(350); expect(fetcher).toHaveBeenCalledOnce(); expect(search.getSnapshot().searched).toBe("행궁동");
    search.setQuery("수원"); search.setQuery(""); await vi.advanceTimersByTimeAsync(400); expect(fetcher).toHaveBeenCalledOnce(); search.pause();
  });
  it("명시적으로 검색하면 한 글자도 가능하고 복귀 시 완료 결과 재사용", async () => {
    const fetcher = vi.fn(async () => Response.json({ places: [candidate("1")] })); const search = new PlaceSearch(fetcher as typeof fetch);
    search.setQuery("밥"); await search.search(); search.pause(); search.resume();
    expect(fetcher).toHaveBeenCalledOnce(); expect(search.getSnapshot().results).toHaveLength(1);
  });
  it("오래된 응답이 늦게 도착해도 새 결과를 덮지 못함", async () => {
    const old = deferred<Response>(); const fetcher = vi.fn().mockReturnValueOnce(old.promise).mockResolvedValueOnce(Response.json({ places: [candidate("new")] })); const search = new PlaceSearch(fetcher);
    search.setQuery("이전"); const first = search.search(); search.setQuery("새검색"); await search.search();
    old.resolve(Response.json({ places: [candidate("old")] })); await first;
    expect(search.getSnapshot()).toMatchObject({ searched: "새검색", results: [candidate("new")], busy: false }); search.pause();
  });
  it("수동 검색도 A 요청 뒤 B 요청을 보내면 B → A 응답에서 B만 표시", async () => {
    vi.useFakeTimers();
    const old = deferred<Response>();
    const fetcher = vi.fn().mockReturnValueOnce(old.promise).mockResolvedValueOnce(Response.json({ places: [candidate("new")] }));
    const search = new PlaceSearch(fetcher);
    search.setQuery("수원 카페", false); await vi.advanceTimersByTimeAsync(500);
    expect(fetcher).not.toHaveBeenCalled();
    const first = search.search();
    search.setQuery("수원 빵집", false); await search.search();
    old.resolve(Response.json({ places: [candidate("old")] })); await first;
    expect(search.getSnapshot()).toMatchObject({ query: "수원 빵집", searched: "수원 빵집", results: [candidate("new")], busy: false, error: "" });
    expect(fetcher.mock.calls.map(([url]) => decodeURIComponent(url))).toEqual(["/api/search?q=수원 카페", "/api/search?q=수원 빵집"]);
    search.pause();
  });
  it("수동 검색어를 바꾸면 이전 응답과 오류를 무시하고 새 검색을 기다림", async () => {
    const old = deferred<Response>(); const search = new PlaceSearch(vi.fn(() => old.promise));
    search.setQuery("수원 카페", false); const first = search.search();
    search.setQuery("수원 빵집", false); old.resolve(new Response("bad", { status: 500 })); await first;
    expect(search.getSnapshot()).toMatchObject({ query: "수원 빵집", searched: "", results: null, busy: false, error: "" });
    search.pause();
  });
  it("화면을 떠난 뒤 응답·오류는 무시하고 복귀하면 미완료 검색 재시도", async () => {
    const old = deferred<Response>(); const fetcher = vi.fn().mockReturnValueOnce(old.promise).mockResolvedValueOnce(Response.json({ places: [] })); const search = new PlaceSearch(fetcher);
    search.setQuery("수원"); const first = search.search(); search.pause(); old.resolve(new Response("bad", { status: 500 })); await first;
    expect(search.getSnapshot()).toMatchObject({ error: "", busy: false, results: null }); search.resume();
    await vi.waitFor(() => expect(search.getSnapshot().searched).toBe("수원")); expect(fetcher).toHaveBeenCalledTimes(2); search.pause();
  });
  it("실패를 빈 결과로 표시하지 않고 같은 검색어로 재시도", async () => {
    const fetcher = vi.fn().mockRejectedValueOnce(new TypeError("offline")).mockResolvedValueOnce(Response.json({ places: [] })); const search = new PlaceSearch(fetcher);
    search.setQuery("수원"); await search.search(); expect(search.getSnapshot().error).toContain("연결"); expect(search.getSnapshot().results).toBeNull();
    await search.search(); expect(search.getSnapshot()).toMatchObject({ query: "수원", error: "", results: [] }); search.pause();
  });
  it.each([
    ["HTML 502", () => new Response("<html>서버 오류: Bad Gateway</html>", { status: 502 }), "검색 결과를 읽지 못했어요. 다시 시도해 주세요."],
    ["깨진 JSON", () => new Response('{"places":', { status: 200 }), "검색 결과를 읽지 못했어요. 다시 시도해 주세요."],
    ["영어 서버 오류", () => Response.json({ message: "Upstream service unavailable" }, { status: 503 }), "연결하지 못했어요. 저장된 장소는 계속 찾을 수 있어요."],
    ["한국어 서버 안내", () => Response.json({ message: "검색어는 100자 이내로 입력해 주세요." }, { status: 400 }), "검색어는 100자 이내로 입력해 주세요."],
  ] as const)("%s는 한국어 안내로 표시하고 재검색할 수 있음", async (_, response, message) => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetcher = vi.fn().mockResolvedValueOnce(response()).mockResolvedValueOnce(Response.json({ places: [candidate("retry")] }));
    const search = new PlaceSearch(fetcher);
    search.setQuery("수원", false); await search.search();
    expect(search.getSnapshot()).toMatchObject({ error: message, busy: false, results: null });
    await search.search();
    expect(search.getSnapshot()).toMatchObject({ error: "", busy: false, searched: "수원", results: [candidate("retry")] });
    search.pause();
  });
  it.each(["fetch", "body"])("%s 응답이 끝나지 않아도 검색 대기가 풀리고 재시도 가능", async (phase) => {
    vi.useFakeTimers();
    const never = new Promise<never>(() => {});
    const fetcher = vi.fn().mockImplementationOnce(() => phase === "fetch" ? never : Promise.resolve({ status: 200, ok: true, json: () => never }))
      .mockResolvedValueOnce(Response.json({ places: [candidate("retry")] }));
    const search = new PlaceSearch(fetcher);
    search.setQuery("수원 카페", false); const pending = search.search();
    await vi.advanceTimersByTimeAsync(10000); await pending;
    expect(search.getSnapshot()).toMatchObject({ query: "수원 카페", busy: false, results: null });
    expect(search.getSnapshot().error).toBe("응답이 늦어지고 있어요. 연결을 확인하고 다시 시도해 주세요.");
    await search.search();
    expect(search.getSnapshot()).toMatchObject({ searched: "수원 카페", busy: false, error: "", results: [candidate("retry")] });
    search.pause();
  });
  it.each([401, 409])("%s 인증 응답은 본문을 파싱하지 않고 캐시 제거 경로로 전달", async (status) => {
    const search = new PlaceSearch(vi.fn(async () => new Response("<html>Sign in</html>", { status })) as typeof fetch); const expired = vi.fn(); search.onUnauthorized = expired;
    search.setQuery("수원"); await search.search(); expect(expired).toHaveBeenCalledOnce();
    expect(search.getSnapshot()).toMatchObject({ error: "", busy: false, results: null }); search.pause();
  });
});
