import { afterEach, describe, expect, it, vi } from "vitest";
import { animateMapCenter } from "@/lib/map-motion";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function clock() {
  let callback: FrameRequestCallback = () => {};
  vi.spyOn(performance, "now").mockReturnValue(0);
  vi.stubGlobal("requestAnimationFrame", vi.fn((next) => { callback = next; return 1; }));
  const cancel = vi.fn(); vi.stubGlobal("cancelAnimationFrame", cancel);
  return { at: (time: number) => callback(time), cancel };
}
describe("카드를 넘길 때 지도 이동", () => {
  it("멀리 떨어진 장소까지 중간 위치를 거쳐 정확한 좌표에 도착함", () => {
    const time = clock(), draw = vi.fn(), from = { lat: 37.2, lng: 127 }, to = { lat: 35.1, lng: 129 };
    animateMapCenter(from, to, draw, 400);
    time.at(0); expect(draw).toHaveBeenLastCalledWith(from);
    time.at(200); const halfway = draw.mock.lastCall![0];
    expect(halfway.lat).toBeGreaterThan(to.lat); expect(halfway.lat).toBeLessThan(from.lat);
    expect(halfway.lng).toBeGreaterThan(from.lng); expect(halfway.lng).toBeLessThan(to.lng);
    time.at(400); expect(draw).toHaveBeenLastCalledWith(to);
  });
  it("다른 카드를 넘기거나 지도를 직접 움직이면 이전 이동을 취소할 수 있음", () => {
    const time = clock(), draw = vi.fn();
    const cancel = animateMapCenter({ lat: 0, lng: 0 }, { lat: 1, lng: 1 }, draw);
    time.at(80); cancel(); const calls = draw.mock.calls.length; time.at(440);
    expect(time.cancel).toHaveBeenCalled(); expect(draw).toHaveBeenCalledTimes(calls);
  });
  it("동작 줄이기 설정에서는 애니메이션 없이 목적지에 도착함", () => {
    const time = clock(), draw = vi.fn(), to = { lat: 1, lng: 1 };
    animateMapCenter({ lat: 0, lng: 0 }, to, draw, 0);
    expect(draw).toHaveBeenCalledTimes(1); expect(draw).toHaveBeenCalledWith(to); expect(requestAnimationFrame).not.toHaveBeenCalled(); expect(time.cancel).not.toHaveBeenCalled();
  });
});
