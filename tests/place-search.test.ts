import { afterEach, describe, expect, it, vi } from "vitest";
import { PlaceSearch, unifiedResults } from "@/lib/place-search";
import type { PlaceView } from "@/lib/place-view";
import type { KakaoPlace } from "@/lib/types";
const candidate = (id: string): KakaoPlace => ({ kakao_place_id: id, name: "행궁동 식당", address: "경기 수원시", category: "음식점", lat: 37, lng: 127, kakao_url: "" });
const place = (id: string, patch: Partial<PlaceView> = {}): PlaceView => ({ ...candidate(id), id, status: "meh", memo: "창가", sharers: [], sources: [], created_at: "", last_saved_at: "", ...patch });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { resolve, promise }; }
afterEach(() => vi.useRealTimers());
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
  it("인증 만료 응답은 캐시 제거 경로로 전달", async () => {
    const search = new PlaceSearch(vi.fn(async () => new Response(null, { status: 401 })) as typeof fetch); const expired = vi.fn(); search.onUnauthorized = expired;
    search.setQuery("수원"); await search.search(); expect(expired).toHaveBeenCalledOnce(); search.pause();
  });
});
