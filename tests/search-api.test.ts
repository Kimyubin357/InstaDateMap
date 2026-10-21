import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, reset, tables } from "./fakeDb";
import { tokenHash } from "@/lib/pin";
vi.mock("@/lib/db", () => ({ db: () => fakeDb }));
vi.mock("@/lib/kakao", () => ({ keywordSearch: vi.fn(async () => Array.from({ length: 10 }, (_, i) => ({ kakao_place_id: String(i), name: "식당" }))) }));
import { keywordSearch } from "@/lib/kakao";
import { GET } from "@/app/api/search/route";
const request = (q: string, authenticated = true) => new Request(`http://localhost/api/search?q=${encodeURIComponent(q)}`, { headers: authenticated ? { cookie: `datemap_session=${"a".repeat(64)}` } : {} });
beforeEach(() => {
  vi.clearAllMocks(); reset(); tables.boards = [{ id: "b1", name: "지도", member_names: ["우리", "서로"], auth_version: 1 }];
  tables.access_sessions = [{ token_hash: tokenHash("a".repeat(64)), board_id: "b1", purpose: "member", member_name: "우리", auth_version: 1, expires_at: "2030-01-01" }];
});
describe("통합 검색의 카카오 조회 API", () => {
  it("빈 검색은 외부 조회 없이 반환하고 한 글자는 검색 가능", async () => {
    expect((await (await GET(request(" "))).json()).places).toEqual([]); expect(keywordSearch).not.toHaveBeenCalled();
    const response = await GET(request("밥")); expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store"); expect((await response.json()).places).toHaveLength(8);
  });
  it("입장 상태가 없거나 긴 검색어면 외부 조회 없이 거절", async () => {
    expect((await GET(request("수원", false))).status).toBe(401); expect((await GET(request("가".repeat(101)))).status).toBe(400); expect(keywordSearch).not.toHaveBeenCalled();
  });
  it("외부 연결 장애를 빈 결과로 바꾸지 않음", async () => {
    vi.mocked(keywordSearch).mockRejectedValueOnce(Error("카카오 검색 연결 실패"));
    const response = await GET(request("수원")); expect(response.status).toBe(500); expect((await response.json()).message).toContain("연결 실패");
  });
});
