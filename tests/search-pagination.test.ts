import { afterEach, expect, it, vi } from "vitest";
import { PlaceSearch, unifiedResults } from "@/lib/place-search";
import type { KakaoPlace } from "@/lib/types";
import type { PlaceView } from "@/lib/place-view";
const place = (id: string, page = 1): KakaoPlace => ({ kakao_place_id: id, name: "카페", address: "서울", category: "카페", lat: 37, lng: 127, kakao_url: "", search_page: page });
const response = (places: KakaoPlace[], is_end = false) => Response.json({ places, is_end });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
it("saved-only first page still loads the next page, deduplicates and preserves the selected page", async () => {
  const saved = Array.from({ length: 8 }, (_, i) => place(String(i)));
  const fetcher = vi.fn().mockResolvedValueOnce(response(saved)).mockResolvedValueOnce(response([place("0", 2), place("new", 2)], true));
  const model = new PlaceSearch(fetcher); model.setQuery("카페", false); await model.search();
  expect(unifiedResults(saved.map((p) => ({ ...p, id: p.kakao_place_id, status: "wish", memo: null, sharers: [], sources: [], created_at: "2026-10-24", last_saved_at: "2026-10-24" })) as PlaceView[], "카페", model.getSnapshot().results!).fresh).toEqual([]);
  await model.loadMore();
  expect(model.getSnapshot()).toMatchObject({ page: 2, hasMore: false, loadingMore: false });
  expect(model.getSnapshot().results).toHaveLength(9);
  expect(model.getSnapshot().results?.at(-1)?.search_page).toBe(2);
  expect(fetcher.mock.calls[1][0]).toContain("page=2"); model.pause();
});
it("next-page failure preserves loaded results and retries the same page", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(response([place("one")])).mockRejectedValueOnce(new TypeError("offline")).mockResolvedValueOnce(response([place("two", 2)], true));
  const model = new PlaceSearch(fetcher); model.setQuery("카페", false); await model.search(); await model.loadMore();
  expect(model.getSnapshot()).toMatchObject({ page: 1, hasMore: true, results: [place("one")] });
  expect(model.getSnapshot().moreError).toBeTruthy(); await model.loadMore();
  expect(model.getSnapshot()).toMatchObject({ page: 2, moreError: "" });
  expect(fetcher.mock.calls[1][0]).toBe(fetcher.mock.calls[2][0]); model.pause();
});
it("a late next page cannot pollute a new query", async () => {
  let finish!: (response: Response) => void;
  const pending = new Promise<Response>((resolve) => { finish = resolve; });
  const fetcher = vi.fn().mockResolvedValueOnce(response([place("old")])).mockReturnValueOnce(pending).mockResolvedValueOnce(response([place("new-query")], true));
  const model = new PlaceSearch(fetcher); model.setQuery("카페", false); await model.search();
  const next = model.loadMore(); model.setQuery("식당", false); await model.search(); finish(response([place("late", 2)])); await next;
  expect(model.getSnapshot()).toMatchObject({ searched: "식당", page: 1, results: [place("new-query")], loadingMore: false }); model.pause();
});
it.each([
  ["HTML 502", () => new Response("<html>서버 오류: Bad Gateway</html>", { status: 502 }), "검색 결과를 읽지 못했어요. 다시 시도해 주세요."],
  ["malformed JSON", () => new Response('{"places":', { status: 200 }), "검색 결과를 읽지 못했어요. 다시 시도해 주세요."],
  ["English server error", () => Response.json({ message: "Upstream service unavailable" }, { status: 503 }), "다음 결과에 연결하지 못했어요. 다시 시도해 주세요."],
  ["Korean server guidance", () => Response.json({ message: "잠시 후 다시 검색해 주세요." }, { status: 503 }), "잠시 후 다시 검색해 주세요."],
] as const)("next-page %s shows Korean guidance, preserves results and retries the same page", async (_, failure, message) => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const fetcher = vi.fn().mockResolvedValueOnce(response([place("one")])).mockResolvedValueOnce(failure()).mockResolvedValueOnce(response([place("two", 2)], true));
  const model = new PlaceSearch(fetcher); model.setQuery("카페", false); await model.search(); await model.loadMore();
  expect(model.getSnapshot()).toMatchObject({ moreError: message, loadingMore: false, page: 1, hasMore: true, results: [place("one")] });
  await model.loadMore();
  expect(model.getSnapshot()).toMatchObject({ moreError: "", loadingMore: false, page: 2, results: [place("one"), place("two", 2)] });
  expect(fetcher.mock.calls[1][0]).toBe(fetcher.mock.calls[2][0]); model.pause();
});
it.each([401, 409])("next-page %s skips body parsing and follows the authorization recovery path", async (status) => {
  const fetcher = vi.fn().mockResolvedValueOnce(response([place("one")])).mockResolvedValueOnce(new Response("<html>Sign in</html>", { status }));
  const model = new PlaceSearch(fetcher); const expired = vi.fn(); model.onUnauthorized = expired;
  model.setQuery("카페", false); await model.search(); await model.loadMore();
  expect(expired).toHaveBeenCalledOnce();
  expect(model.getSnapshot()).toMatchObject({ moreError: "", loadingMore: false, page: 1, results: [place("one")] }); model.pause();
});
