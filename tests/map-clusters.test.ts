import { describe, expect, it } from "vitest";
import { regionCards, regionTier, shortRegionName, stackCards, type ScreenPoint } from "@/lib/map-clusters";
import type { MapRegion } from "@/lib/map-regions";
import type { PlaceStatus } from "@/lib/types";

const seongsu: MapRegion = { province: "서울특별시", city: "서울특별시", district: "서울특별시 성동구", local: "서울특별시 성동구 성수1가1동" };
const oksu: MapRegion = { province: "서울특별시", city: "서울특별시", district: "서울특별시 성동구", local: "서울특별시 성동구 옥수동" };
const mapo: MapRegion = { province: "서울특별시", city: "서울특별시", district: "서울특별시 마포구", local: "서울특별시 마포구 연남동" };
const gwacheon: MapRegion = { province: "경기도", city: "경기도 과천시", district: "경기도 과천시", local: "경기도 과천시 중앙동" };
const suwon: MapRegion = { province: "경기도", city: "경기도 수원시", district: "경기도 수원시 장안구", local: "경기도 수원시 장안구 정자1동" };
type P = { id: string; x: number; y: number; status: PlaceStatus; region: MapRegion | null };
const place = (id: string, region: MapRegion | null, status: PlaceStatus = "wish", x = 0, y = 0): P => ({ id, x, y, status, region });
const project = (p: P): ScreenPoint => ({ x: p.x, y: p.y });
const cards = (places: P[], level: number, extra: { isNew?: (p: P) => boolean; allPlaces?: P[] } = {}) =>
  regionCards(places, project, { level, region: (p) => p.region, isNew: extra.isNew ?? (() => false), allPlaces: extra.allPlaces });
const labels = (list: { label: string | null }[]) => list.map((c) => c.label).sort();

describe("지역 집계 카드", () => {
  it("확대 단계에 따라 도(12~14) → 시(9~11) → 구(7~8) → 동(4~6) 단위로 나눔", () => {
    expect([14, 12, 11, 9, 8, 7, 6, 4].map(regionTier)).toEqual(["province", "province", "city", "city", "district", "district", "local", "local"]);
    const places = [place("a", seongsu), place("b", oksu), place("c", mapo), place("d", gwacheon), place("e", suwon)];
    expect(labels(cards(places, 12))).toEqual(["경기", "서울"]);
    expect(labels(cards(places, 9))).toEqual(["과천시", "서울", "수원시"]);
    expect(labels(cards(places, 7))).toEqual(["과천시", "마포구", "성동구", "장안구"]);
    expect(labels(cards(places, 6))).toEqual(["성수1가1동", "연남동", "옥수동", "정자1동", "중앙동"]);
  });
  it("같은 지역이면 화면에서 떨어져 있어도 카드 한 장으로 묶음", () => {
    const list = cards([place("a", seongsu, "wish", 0), place("b", seongsu, "wish", 400)], 5);
    expect(list).toHaveLength(1); expect(list[0].x).toBe(200); expect(list[0].places).toHaveLength(2);
  });
  it("지역명을 줄여 보여 줌", () => {
    expect(["서울특별시", "부산광역시", "세종특별자치시", "경기도", "충청북도", "전북특별자치도", "제주특별자치도", "경기도 수원시", "경기도 수원시 장안구", "서울특별시 성동구 성수1가1동"].map(shortRegionName))
      .toEqual(["서울", "부산", "세종", "경기", "충북", "전북", "제주", "수원시", "장안구", "성수1가1동"]);
  });
  it("숫자는 가고 싶음만 세고 또 갈래만 있으면 0", () => {
    const [mixed] = cards([place("a", seongsu), place("b", seongsu, "again"), place("c", seongsu)], 5);
    expect(mixed.wish).toBe(2);
    const [againOnly] = cards([place("a", oksu, "again")], 5);
    expect(againOnly.wish).toBe(0); expect(againOnly.places).toHaveLength(1);
  });
  it("진행 바는 필터에 가려진 장소까지 그 지역 전체 기준으로 셈", () => {
    const shown = [place("a", seongsu), place("b", seongsu, "again")];
    const all = [...shown, place("c", seongsu, "visited"), place("d", seongsu, "meh"), place("e", mapo, "visited")];
    const [card] = cards(shown, 5, { allPlaces: all });
    expect([card.visited, card.total]).toEqual([3, 4]);
    const [district] = cards(shown, 7, { allPlaces: all });
    expect([district.visited, district.total]).toEqual([3, 4]);
    const [city] = cards(shown, 9, { allPlaces: all });
    expect([city.visited, city.total]).toEqual([4, 5]);
  });
  it("NEW 장소 수를 카드마다 셈", () => {
    const list = cards([place("a", seongsu), place("b", seongsu), place("c", mapo)], 5, { isNew: (p) => p.id !== "b" });
    expect(Object.fromEntries(list.map((c) => [c.label, c.fresh]))).toEqual({ 성수1가1동: 1, 연남동: 1 });
  });
  it("지역 조회 전·실패한 장소는 이름 없이 따로 표시하고 다른 장소와 합치지 않음", () => {
    const list = cards([place("a", null), place("b", null), place("c", { ...seongsu, local: null })], 5);
    expect(list).toHaveLength(3); expect(list.every((c) => c.label === null)).toBe(true);
  });
  it("같은 장소가 중복되거나 좌표가 깨진 장소는 셈에 넣지 않음", () => {
    const a = place("a", seongsu);
    const list = cards([a, a, { ...place("b", seongsu), x: Number.NaN }], 5);
    expect(list).toHaveLength(1); expect(list[0].places).toHaveLength(1);
  });
  it("공유 배열과 장소 객체를 변경하지 않음", () => {
    const places = Object.freeze([Object.freeze(place("b", mapo)), Object.freeze(place("a", seongsu))]);
    cards(places as P[], 5);
    expect(places.map((p) => p.id)).toEqual(["b", "a"]);
  });
});

describe("카드 겹침", () => {
  const order = (list: { label: string | null }[]) => stackCards(list as never).map((c: { label: string | null }) => c.label);
  it("숨기지 않고 모두 그리며 장소가 많은 카드를 위(뒤 순서)에 둠", () => {
    const list = cards([place("a", seongsu), place("b", seongsu), place("c", gwacheon), place("d", suwon), place("e", suwon), place("f", suwon)], 9);
    expect(order(list)).toEqual(["과천시", "서울", "수원시"]);
  });
  it("장소 수가 같으면 가나다순으로 앞선 지역이 위, 이름 없는 카드는 맨 아래", () => {
    const list = cards([place("a", gwacheon), place("b", seongsu), place("c", null)], 9);
    expect(order(list)).toEqual([null, "서울", "과천시"]);
  });
});
