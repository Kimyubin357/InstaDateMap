import { describe, expect, it } from "vitest";
import { clusterPlaces as cluster, type ScreenPoint } from "@/lib/map-clusters";
import type { MapRegion } from "@/lib/map-regions";
import type { PlaceStatus } from "@/lib/types";

const place = (id: string, x: number, y = 0, status: PlaceStatus = "wish") => ({ id, x, y, status });
const project = (p: ScreenPoint) => p;
const region: MapRegion = { city: "경기도 수원시", district: "경기도 수원시 장안구", local: "경기도 수원시 장안구 정자1동" };
const clusterPlaces = <T extends ReturnType<typeof place>>(places: readonly T[], projection: (p: T) => ScreenPoint = project) =>
  cluster(places, projection, { level: 7, region: () => region, size: () => ({ width: 72, height: 32 }) });
const memberships = (groups: ReturnType<typeof clusterPlaces>) => groups.map((group) => group.places.map((p) => p.id).sort()).sort();

describe("지도 숫자 핀 집계", () => {
  it("빈 지도에는 숫자 핀을 만들지 않음", () => {
    expect(clusterPlaces([], project)).toEqual([]);
  });
  it("가까운 장소는 합치고 멀리 떨어진 장소는 따로 셈", () => {
    const groups = clusterPlaces([place("a", 0), place("b", 45), place("c", 300)], project);
    expect(memberships(groups)).toEqual([["a", "b"], ["c"]]);
    expect(groups.find((g) => g.places.length === 2)?.x).toBe(22.5);
  });
  it("가깝더라도 이름표가 세로로 겹치지 않으면 합치지 않음", () => {
    expect(clusterPlaces([place("a", 0), place("b", 70, 70)], project)).toHaveLength(2);
  });
  it("셀 경계와 음수 화면 좌표에서도 이웃 장소를 놓치지 않음", () => {
    expect(memberships(clusterPlaces([place("a", -2, -2), place("b", 2, 2), place("c", 81, 2)], project))).toEqual([["a", "b", "c"]]);
  });
  it("연결된 중간 장소가 나중에 들어와도 양쪽 그룹을 합침", () => {
    expect(memberships(clusterPlaces([place("a", 0), place("b", 140), place("z", 70)], project))).toEqual([["a", "b", "z"]]);
  });
  it("순서 변경과 지도 이동으로 구성원이 바뀌지 않음", () => {
    const places = [place("z", 20, 50), place("a", 40, 40), place("b", 300)];
    const first = clusterPlaces(places, project);
    const moved = clusterPlaces([...places].reverse(), (p) => ({ x: p.x - 1093.7, y: p.y + 782.25 }));
    expect(memberships(moved)).toEqual(memberships(first));
    expect(moved.map((g) => g.key)).toEqual(first.map((g) => g.key));
  });
  it("확대하면 나뉘고 축소하면 같은 장소를 빠짐없이 다시 묶음", () => {
    const places = [place("a", 0), place("b", 50), place("c", 150)];
    const wide = clusterPlaces(places, (p) => ({ x: p.x / 2, y: p.y / 2 }));
    const close = clusterPlaces(places, (p) => ({ x: p.x * 2, y: p.y * 2 }));
    expect(wide).toHaveLength(1); expect(close).toHaveLength(3);
    expect(close.flatMap((g) => g.places.map((p) => p.id)).sort()).toEqual(["a", "b", "c"]);
  });
  it("또 갈래·다녀옴·별로만 방문한 곳으로 집계함", () => {
    const [group] = clusterPlaces([place("a", 0), place("b", 1, 0, "again"), place("c", 2, 0, "visited"), place("d", 3, 0, "meh")], project);
    expect(group.visited).toBe(3); expect(group.places).toHaveLength(4);
  });
  it("방문율이 0%와 100%인 그룹도 분모를 유지함", () => {
    const groups = clusterPlaces([place("a", 0), place("b", 1), place("c", 400, 0, "visited"), place("d", 401, 0, "again")], project);
    expect(groups.map((g) => g.visited / g.places.length)).toEqual([0, 1]);
  });
  it("필터 결과와 삭제·상태 변경을 다음 집계에 즉시 반영함", () => {
    const places = [place("a", 0), place("b", 1, 0, "visited")];
    expect(clusterPlaces(places.filter((p) => p.status === "wish"), project)[0].visited).toBe(0);
    expect(clusterPlaces([{ ...places[0], status: "visited" as const }], project)[0].visited).toBe(1);
  });
  it("같은 장소가 중복 전달되어도 한 번만 셈", () => {
    const p = place("a", 0);
    const [group] = clusterPlaces([p, p, place("b", 1)], project);
    expect(group.places).toHaveLength(2);
  });
  it("좌표 변환이 불가능한 장소는 오염된 그룹을 만들지 않음", () => {
    const groups = clusterPlaces([place("a", Number.NaN), place("b", 1)], project);
    expect(memberships(groups)).toEqual([["b"]]); expect(groups[0].x).toBe(1);
  });
  it("공유 캐시의 배열과 장소 객체를 변경하지 않음", () => {
    const places = Object.freeze([Object.freeze(place("b", 40)), Object.freeze(place("a", 0))]);
    clusterPlaces(places, project);
    expect(places.map((p) => p.id)).toEqual(["b", "a"]);
  });
});

describe("행정구역과 실제 이름표 겹침", () => {
  const a = { ...place("a", 0), region };
  const b = { ...place("b", 10), region: { ...region, local: "경기도 수원시 장안구 정자2동" } };
  const groups = (items: typeof a[], level: number, width = 72) => cluster(items, project, { level, region: (p) => p.region, size: () => ({ width, height: 32 }) });
  it("멀리서는 같은 구의 다른 동을 묶고 가까이서는 동 경계를 지킴", () => {
    expect(groups([a, b], 8)).toHaveLength(1);
    expect(groups([a, b], 7)).toHaveLength(2);
    expect(groups([a, b], 4)).toHaveLength(2);
  });
  it("구 단위에서는 같은 시라도 구가 다르면 묶지 않음", () => {
    const other = { ...b, region: { ...region, district: "경기도 수원시 팔달구", local: "경기도 수원시 팔달구 화서1동" } };
    expect(groups([a, other], 9)).toHaveLength(2);
    expect(groups([a, other], 5)).toHaveLength(2);
  });
  it("같은 동 이름이 다른 시·구에 있어도 묶지 않음", () => {
    const other = { ...b, region: { city: "경기도 성남시", district: "경기도 성남시 분당구", local: "경기도 성남시 분당구 정자1동" } };
    expect(groups([a, other], 6)).toHaveLength(2);
    expect(groups([a, other], 12)).toHaveLength(2);
  });
  it("행정구역을 모르는 장소는 같은 fallback으로 합치지 않음", () => {
    expect(cluster([a, b], project, { level: 10, region: () => null, size: () => ({ width: 72, height: 32 }) })).toHaveLength(2);
    expect(cluster([a, b], project, { level: 7, region: () => ({ ...region, local: null }), size: () => ({ width: 72, height: 32 }) })).toHaveLength(2);
  });
  it("같은 구역이라도 이름표가 겹치지 않으면 각각 표시함", () => {
    expect(groups([a, { ...a, id: "b", x: 200 }], 10)).toHaveLength(2);
  });
  it("긴 이름표의 실제 너비를 반영하고 가장 가까이 확대하면 전부 개별 표시함", () => {
    const second = { ...a, id: "b", x: 130 };
    expect(groups([a, second], 7, 72)).toHaveLength(2);
    expect(groups([a, second], 7, 200)).toHaveLength(1);
    expect(groups([a, { ...second, x: 0 }], 3, 200)).toHaveLength(2);
  });
  it("동 정보가 없을 때는 구 단위 축소에서만 묶음", () => {
    const items = [a, { ...a, id: "b" }];
    const run = (level: number) => cluster(items, project, { level, region: () => ({ ...region, local: null }), size: () => ({ width: 72, height: 32 }) });
    expect(run(8)).toHaveLength(1); expect(run(7)).toHaveLength(2);
  });
  it("세 구에 한 곳씩 있는 수원 장소도 멀리서는 3곳으로 묶고 구 단계에서는 나눔", () => {
    const items = [a, { ...b, region: { ...region, district: "경기도 수원시 권선구", local: "경기도 수원시 권선구 권선1동" } },
      { ...b, id: "c", x: 20, region: { ...region, district: "경기도 수원시 팔달구", local: "경기도 수원시 팔달구 화서1동" } }];
    const wide = groups(items, 10);
    expect(wide).toHaveLength(1); expect(wide[0].places).toHaveLength(3); expect(wide[0].region).toBe("경기도 수원시");
    expect(groups(items, 9)).toHaveLength(3);
  });
  it("확대·축소로 시→구→동 단계가 바뀌어도 수와 방문 집계가 보존됨", () => {
    const items = [a, { ...b, status: "visited" as const }, { ...b, id: "c", region: { ...region, district: "경기도 수원시 팔달구", local: "경기도 수원시 팔달구 화서1동" } }];
    expect(groups(items, 10)).toHaveLength(1);
    expect(groups(items, 8)).toHaveLength(2);
    expect(groups(items, 7)).toHaveLength(3);
    for (const level of [12, 9, 7, 3, 10]) {
      const result = groups(items, level);
      expect(result.flatMap((g) => g.places)).toHaveLength(3);
      expect(result.reduce((sum, g) => sum + g.visited, 0)).toBe(1);
    }
  });
  it("시 단위에서도 겹치지 않는 이름표와 다른 도시는 합치지 않음", () => {
    expect(groups([a, { ...b, x: 200 }], 12)).toHaveLength(2);
    expect(groups([a, { ...b, region: { city: "대전광역시", district: "대전광역시 동구", local: "대전광역시 동구 중앙동" } }], 12)).toHaveLength(2);
  });
  it("상위 도시를 확인하지 못한 곳을 시 단계에서 임의로 합치지 않음", () => {
    expect(cluster([a, b], project, { level: 10, region: () => ({ ...region, city: null }), size: () => ({ width: 72, height: 32 }) })).toHaveLength(2);
  });
});
