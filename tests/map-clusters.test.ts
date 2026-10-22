import { describe, expect, it } from "vitest";
import { clusterPlaces, type ScreenPoint } from "@/lib/map-clusters";
import type { PlaceStatus } from "@/lib/types";

const place = (id: string, x: number, y = 0, status: PlaceStatus = "wish") => ({ id, x, y, status });
const project = (p: ScreenPoint) => p;
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
  it("원형 거리로 판단해 대각선으로 먼 장소를 잘못 합치지 않음", () => {
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
