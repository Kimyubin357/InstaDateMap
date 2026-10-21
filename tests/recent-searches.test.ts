import { afterEach, describe, expect, it, vi } from "vitest";
import { RecentSearches, clearRecentSearches } from "@/lib/recent-searches";
import { BoardStore } from "@/lib/board-store";
const access = { boardId: "b1", authVersion: 1 };
function storage() {
  const values = new Map<string, string>();
  return { get length() { return values.size; }, key: (i: number) => [...values.keys()][i] || null, getItem: (key: string) => values.get(key) || null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
}
afterEach(() => vi.unstubAllGlobals());
describe("기기 최근 검색", () => {
  it("20개 제한, 중복은 맨 위, 새 인스턴스에서 복원", () => {
    const disk = storage(), history = new RecentSearches(access, disk);
    for (let i = 0; i < 25; i++) history.add(`검색 ${i}`);
    expect(history.read()).toHaveLength(20); history.add(" 검색   10 ");
    expect(history.read()[0]).toBe("검색 10"); expect(history.read()).toHaveLength(20); expect(new RecentSearches(access, disk).read()).toEqual(history.read());
  });
  it("보드·인증 버전별 분리, 개별·전체 삭제", () => {
    const disk = storage(), history = new RecentSearches(access, disk); history.add("수원"); history.add("행궁동");
    expect(new RecentSearches({ ...access, boardId: "b2" }, disk).read()).toEqual([]);
    expect(new RecentSearches({ ...access, authVersion: 2 }, disk).read()).toEqual([]);
    expect(history.remove("수원")).toEqual(["행궁동"]); expect(history.clear()).toEqual([]); expect(new RecentSearches(access, disk).read()).toEqual([]);
  });
  it("손상·저장 실패·빈 검색어에도 동작", () => {
    const disk = storage(); disk.setItem("datemap-search-v1:b1:1", '{"broken":true}'); const history = new RecentSearches(access, disk);
    expect(history.read()).toEqual([]); vi.spyOn(disk, "setItem").mockImplementation(() => { throw Error("quota"); });
    expect(history.add("수원")).toEqual(["수원"]); expect(history.add("  ")).toEqual(["수원"]); vi.spyOn(disk, "removeItem").mockImplementation(() => { throw Error("denied"); }); expect(history.clear()).toEqual([]);
  });
  it("잠금 시 검색 기록을 제거하되 다른 앱 저장소는 유지", async () => {
    const disk = storage(); vi.stubGlobal("localStorage", disk); new RecentSearches(access).add("수원"); new RecentSearches({ ...access, boardId: "b2" }).add("서울"); disk.setItem("another-app", "keep");
    const store = new BoardStore({ read: async () => null, write: async () => {}, clear: async () => {} }); await store.forget();
    expect(new RecentSearches(access).read()).toEqual([]); expect(disk.length).toBe(1); expect(disk.getItem("another-app")).toBe("keep");
    expect(() => clearRecentSearches()).not.toThrow();
  });
});
