import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, reset, tables } from "./fakeDb";
import { tokenHash } from "@/lib/pin";
vi.mock("@/lib/db", () => ({ db: () => fakeDb }));
vi.mock("@/lib/kakao", () => ({ keywordSearchPage: vi.fn(async (_query: string, page = 1) => ({ places: Array.from({ length: 8 }, (_, i) => ({ kakao_place_id: String(i), name: "식당" })), page, is_end: page >= 2, total_count: 12 })) }));
import { keywordSearchPage } from "@/lib/kakao";
import { GET } from "@/app/api/search/route";
const request = (q: string, authenticated = true) => new Request(`http://localhost/api/search?q=${encodeURIComponent(q)}`, { headers: authenticated ? { cookie: `datemap_session=${"a".repeat(64)}` } : {} });
beforeEach(() => {
  vi.clearAllMocks(); reset(); tables.boards = [{ id: "b1", name: "지도", member_names: ["우리", "서로"], auth_version: 1 }];
  tables.access_sessions = [{ token_hash: tokenHash("a".repeat(64)), board_id: "b1", purpose: "member", member_name: "우리", auth_version: 1, expires_at: "2030-01-01" }];
});
describe("통합 검색의 카카오 조회 API", () => {
  it("빈 검색은 외부 조회 없이 반환하고 한 글자는 검색 가능", async () => {
    expect((await (await GET(request(" "))).json()).places).toEqual([]); expect(keywordSearchPage).not.toHaveBeenCalled();
    const response = await GET(request("밥")); expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store"); expect((await response.json()).places).toHaveLength(8);
  });
  it("입장 상태가 없거나 긴 검색어면 외부 조회 없이 거절", async () => {
    expect((await GET(request("수원", false))).status).toBe(401); expect((await GET(request("가".repeat(101)))).status).toBe(400); expect(keywordSearchPage).not.toHaveBeenCalled();
  });
  it("외부 연결 장애를 빈 결과로 바꾸지 않음", async () => {
    vi.mocked(keywordSearchPage).mockRejectedValueOnce(Error("카카오 검색 연결 실패"));
    const response = await GET(request("수원")); expect(response.status).toBe(500); expect((await response.json()).message).toContain("연결 실패");
  });
});

it("next pages retain provider metadata and annotate selection origin", async () => {
  const response = await GET(new Request("http://localhost/api/search?q=식당&page=2", { headers: { cookie: `datemap_session=${"a".repeat(64)}` } }));
  expect(await response.json()).toMatchObject({ page: 2, is_end: true, total_count: 12, places: [expect.objectContaining({ search_page: 2 }), ...Array.from({length:7},()=>expect.any(Object))] });
  expect(keywordSearchPage).toHaveBeenCalledWith("식당", 2);
});
it.each(["0", "46", "NaN", "1.5"])("invalid search page %s is rejected without a provider call", async (page) => {
  const response = await GET(new Request(`http://localhost/api/search?q=식당&page=${page}`, { headers: { cookie: `datemap_session=${"a".repeat(64)}` } }));
  expect(response.status).toBe(400); expect(keywordSearchPage).not.toHaveBeenCalled();
});
