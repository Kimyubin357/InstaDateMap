import { describe, expect, it } from "vitest";
import { filterPlaces, sortPlaces, distanceM, type PlaceView } from "@/lib/place-view";
const place = (id: string, over: Partial<PlaceView> = {}): PlaceView => ({ id, name: "도나스데이", address: "경기 수원시", category: "카페", status: "wish", memo: "창가 자리", lat: 37.24, lng: 126.97, kakao_url: "", sharers: [], sources: [], created_at: "2026-01-01", last_saved_at: "2026-01-01", ...over });
describe("지도와 리스트의 공통 보기", () => {
  it("상호·주소·메모와 상태·분류 필터를 동시에 적용", () => {
    const all = [place("one"), place("two", { status: "visited", category: "음식점" })];
    expect(filterPlaces(all, "수원 창가", ["wish"], "카페").map((p) => p.id)).toEqual(["one"]);
    expect(filterPlaces(all, "없는곳", ["wish"], "")).toEqual([]);
  });
  it("최근 저장과 가까운순은 원본 목록을 변경하지 않음", () => {
    const all = [place("old"), place("new", { last_saved_at: "2026-02-01", lat: 38 })];
    expect(sortPlaces(all).map((p) => p.id)).toEqual(["new", "old"]);
    expect(sortPlaces(all, { lat: 37.24, lng: 126.97 }).map((p) => p.id)).toEqual(["old", "new"]);
    expect(all[0].id).toBe("old"); expect(distanceM(all[0], all[0])).toBe(0);
  });
});
