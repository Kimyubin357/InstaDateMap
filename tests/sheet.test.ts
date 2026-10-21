import { describe, expect, it } from "vitest";
import { settleSheet, sheetStops } from "@/lib/sheet";

describe("손잡이로 조절하는 바텀시트", () => {
  it("작은 화면과 키보드가 열린 화면에서도 세 단계가 화면 안에 남음", () => {
    for (const viewport of [320, 560, 844]) {
      const stops = sheetStops(viewport);
      expect(stops[0]).toBeLessThan(stops[1]); expect(stops[1]).toBeLessThan(stops[2]);
      expect(stops[2]).toBeLessThan(viewport);
    }
  });
  it("천천히 놓으면 가까운 단계로 멈추고 위로 끌면 펼침", () => {
    const stops = sheetStops(844);
    expect(settleSheet(270, 0, stops)).toBe(0);
    expect(settleSheet(535, 0, stops)).toBe(1);
    expect(settleSheet(720, -.5, stops)).toBe(2);
  });
  it("아래로 끝까지 내리거나 충분히 빠르게 내리면 닫음", () => {
    const stops = sheetStops(844);
    expect(settleSheet(100, 0, stops)).toBeNull();
    expect(settleSheet(250, 1, stops)).toBeNull();
    expect(settleSheet(250, 0, stops)).toBe(0);
  });
});
