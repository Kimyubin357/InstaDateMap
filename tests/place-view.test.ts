import { describe, expect, it } from "vitest";
import { filterPlaces, sortPlaces, distanceM, placeMeta, type PlaceView } from "@/lib/place-view";
const place = (id: string, over: Partial<PlaceView> = {}): PlaceView => ({ id, name: "도나스데이", address: "경기 수원시", category: "카페", status: "wish", memo: "창가 자리", lat: 37.24, lng: 126.97, kakao_place_id: id, kakao_url: "", sharers: [], sources: [], created_at: "2026-01-01", last_saved_at: "2026-01-01", ...over });
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
  it.each([
    ["서울 중구 세종대로 110", "서울 중구"],
    ["서울특별시 중구 세종대로 110", "서울 중구"],
    ["서울특별시 강남구 테헤란로 1", "서울 강남구"],
    ["부산광역시 중구 중앙대로 1", "부산 중구"],
    ["부산 기장군 기장읍 기장대로 1", "부산 기장군"],
    ["대전광역시 서구 둔산로 1", "대전 서구"],
    ["광주광역시 북구 용봉로 1", "광주 북구"],
    ["경기 광주시 중앙로 1", "경기 광주시"],
    ["경기 수원시 장안구 정조로 1", "수원 장안구"],
    ["경기도 수원시 팔달구 효원로 1", "수원 팔달구"],
    ["경기도 성남시 분당구 판교역로 1", "성남 분당구"],
    ["수원시 장안구 정조로 1", "수원 장안구"],
    ["경기도 파주시 문산읍 문산로 1", "경기 파주시"],
    ["충청남도 아산시 배방읍 희망로 1", "충남 아산시"],
    ["강원특별자치도 고성군 토성면 토성로 1", "강원 고성군"],
    ["경상남도 고성군 고성읍 중앙로 1", "경남 고성군"],
    ["전북특별자치도 완주군 삼례읍 삼례로 1", "전북 완주군"],
    ["세종특별자치시 한누리대로 1", "세종"],
    ["세종 조치원읍 새내로 1", "세종 조치원읍"],
    ["세종시 나성동 1", "세종 나성동"],
    ["제주특별자치도 제주시 중앙로 1", "제주 제주시"],
    ["제주 서귀포시 성산읍 성산로 1", "제주 서귀포시"],
    ["  서울특별시\t중구   세종대로 110  ", "서울 중구"],
    ["서울특별시", "서울"],
    ["경기도", "경기"],
  ])("지역을 식별할 수 있는 최소 행정구역을 표시: %s", (address, region) => {
    expect(placeMeta({ address, category: "카페" })).toBe(`카페 · ${region}`);
  });
  it.each([null, "", "   "])("주소가 없으면 분류만 표시: %s", (address) => {
    expect(placeMeta({ address, category: "카페" })).toBe("카페");
    expect(placeMeta({ address, category: null })).toBe("");
  });
  it("분류가 없으면 지역만 표시하고 행정구역이 없는 주소를 잘라내지 않음", () => {
    expect(placeMeta({ address: "서울 중구 세종대로 110", category: null })).toBe("서울 중구");
    expect(placeMeta({ address: "양평군", category: null })).toBe("양평군");
  });
});
