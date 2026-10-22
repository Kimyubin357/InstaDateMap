import { afterEach, describe, expect, it, vi } from "vitest";
import { administrativeRegion, MapRegionCache, regionPointKey, type RegionDocument } from "@/lib/map-regions";

const h: RegionDocument = { region_type: "H", region_1depth_name: "경기도", region_2depth_name: "수원시 장안구", region_3depth_name: "정자1동" };
const point = { lat: 37.3, lng: 127 };
afterEach(() => vi.useRealTimers());

describe("카카오 행정구역 구분", () => {
  it("법정동이 먼저 있어도 행정동을 선택함", () => {
    expect(administrativeRegion([{ ...h, region_type: "B", region_3depth_name: "정자동" }, h])).toEqual({ district: "경기도 수원시 장안구", local: "경기도 수원시 장안구 정자1동" });
  });
  it("동 없이 읍·면만 있는 지역도 상위 구역까지 포함함", () => {
    expect(administrativeRegion([{ ...h, region_2depth_name: "양평군", region_3depth_name: "서종면" }])?.local).toBe("경기도 양평군 서종면");
  });
  it("세종은 구 정보가 없어도 구별하고 누락된 동은 추측하지 않음", () => {
    expect(administrativeRegion([{ ...h, region_1depth_name: "세종특별자치시", region_2depth_name: "", region_3depth_name: "한솔동" }])?.local).toBe("세종특별자치시 한솔동");
    expect(administrativeRegion([{ ...h, region_3depth_name: "" }])?.local).toBeNull();
  });
  it("빈 응답·법정동만 있는 응답·불완전한 구역은 합치지 않음", () => {
    expect(administrativeRegion([])).toBeNull();
    expect(administrativeRegion([{ ...h, region_type: "B" }])).toBeNull();
    expect(administrativeRegion([{ ...h, region_2depth_name: "" }])).toBeNull();
  });
});
describe("지도 인스턴스의 행정구역 조회 캐시", () => {
  it("같은 좌표의 동시 요청·반복 요청은 한 번만 조회함", async () => {
    const cache = new MapRegionCache(), lookup = vi.fn(async () => administrativeRegion([h]));
    const results = await Promise.all([cache.resolve(point, lookup), cache.resolve(point, lookup)]);
    expect(results[0]).toEqual(results[1]);
    await cache.resolve(point, lookup); expect(lookup).toHaveBeenCalledTimes(1);
  });
  it("실패해도 개별 표시를 위해 null을 반환하고 1분 후 재조회함", async () => {
    vi.useFakeTimers();
    const cache = new MapRegionCache(), lookup = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(administrativeRegion([h]));
    expect(await cache.resolve(point, lookup)).toBeNull();
    expect(await cache.resolve(point, lookup)).toBeNull();
    expect(lookup).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60_001);
    expect(await cache.resolve(point, lookup)).toEqual(administrativeRegion([h]));
  });
  it("성공한 결과도 하루 뒤 갱신함", async () => {
    vi.useFakeTimers();
    const cache = new MapRegionCache(), lookup = vi.fn(async () => administrativeRegion([h]));
    await cache.resolve(point, lookup); vi.advanceTimersByTime(24 * 60 * 60_000 + 1);
    expect(cache.get(point)).toBeUndefined();
    await cache.resolve(point, lookup); expect(lookup).toHaveBeenCalledTimes(2);
  });
  it("좌표 변경과 다른 지도 인스턴스 사이에서 결과를 섞지 않음", async () => {
    const cache = new MapRegionCache(), lookup = vi.fn(async () => administrativeRegion([h]));
    await cache.resolve(point, lookup);
    expect(cache.get({ ...point, lat: 37.31 })).toBeUndefined();
    expect(new MapRegionCache().get(point)).toBeUndefined();
    expect(regionPointKey(point)).not.toBe(regionPointKey({ ...point, lng: 128 }));
  });
});
