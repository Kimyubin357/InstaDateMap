import { afterEach, describe, expect, it, vi } from "vitest";
import { layoutViewportHeight, visibleViewport } from "@/lib/viewport";
afterEach(() => vi.unstubAllGlobals());
describe("PWA 전체 높이와 키보드 영역", () => {
  it("설치 후 보고되는 793px 대신 CSS 루트의 전체 852px를 사용", () => {
    vi.stubGlobal("window", { innerHeight: 793 });
    vi.stubGlobal("document", { documentElement: { clientHeight: 793 } });
    vi.stubGlobal("getComputedStyle", () => ({ height: "852px" }));
    expect(layoutViewportHeight()).toBe(852);
  });
  it("브라우저의 정상 높이를 늘리거나 안전영역을 이중으로 더하지 않음", () => {
    vi.stubGlobal("window", { innerHeight: 844 });
    vi.stubGlobal("document", { documentElement: { clientHeight: 844 } });
    vi.stubGlobal("getComputedStyle", () => ({ height: "844px" }));
    expect(layoutViewportHeight()).toBe(844);
  });
  it("루트 높이를 읽지 못하면 기존 화면 크기를 유지", () => {
    vi.stubGlobal("window", { innerHeight: 844 });
    vi.stubGlobal("document", { documentElement: { clientHeight: 844 } });
    vi.stubGlobal("getComputedStyle", () => ({ height: "auto" }));
    expect(layoutViewportHeight()).toBe(844);
  });
  it("59px 차이와 입력 포커스만으로 키보드가 열렸다고 판단하지 않음", () => {
    expect(visibleViewport(852, 793, 0, true)).toEqual({ keyboard: false, height: 852, top: 0 });
  });
  it("키보드가 열릴 때만 보이는 영역에 검색 내용과 시트를 맞춤", () => {
    expect(visibleViewport(852, 480, 59, true)).toEqual({ keyboard: true, height: 480, top: 59 });
    expect(visibleViewport(852, 480, 999, true)).toEqual({ keyboard: true, height: 480, top: 372 });
    expect(visibleViewport(852, 480, -10, true)).toEqual({ keyboard: true, height: 480, top: 0 });
  });
  it("회전·키보드 닫힘·포커스 해제 후 전체 화면으로 복귀", () => {
    expect(visibleViewport(393, 393, 0, false)).toEqual({ keyboard: false, height: 393, top: 0 });
    expect(visibleViewport(852, 793, 59, false)).toEqual({ keyboard: false, height: 852, top: 0 });
  });
});
