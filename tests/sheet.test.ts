import { describe, expect, it } from "vitest";
import { contentPullDecision, settleSheet, sheetStops } from "@/lib/sheet";

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
    expect(settleSheet(270, 0, stops, { stop: 0, height: stops[0] })).toBe(0);
    expect(settleSheet(535, 0, stops, { stop: 0, height: stops[0] })).toBe(1);
    expect(settleSheet(720, -.5, stops, { stop: 1, height: stops[1] })).toBe(2);
  });
  it("최소 높이에서 아래로 끝까지 내리거나 충분히 빠르게 내리면 닫음", () => {
    const stops = sheetStops(844);
    expect(settleSheet(100, 0, stops, { stop: 0, height: stops[0] })).toBeNull();
    expect(settleSheet(250, 1, stops, { stop: 0, height: stops[0] })).toBeNull();
    expect(settleSheet(250, 0, stops, { stop: 0, height: stops[0] })).toBe(0);
  });
  it("최대에서 내리면 거리와 속도에 관계없이 중간에 멈춤", () => {
    for (const viewport of [320, 560, 844, 1100]) {
      const stops = sheetStops(viewport);
      for (const distance of [6, 40, viewport]) for (const speed of [0, .5, 3, 20]) {
        expect(settleSheet(stops[2] - distance, speed, stops, { stop: 2, height: stops[2] })).toBe(1);
      }
    }
  });
  it("중간에서 강하게 당겨도 최소에 먼저 멈추고 다음 제스처에서 닫음", () => {
    const stops = sheetStops(844);
    const minimum = settleSheet(50, 3, stops, { stop: 1, height: stops[1] });
    expect(minimum).toBe(0);
    expect(settleSheet(50, 3, stops, { stop: minimum!, height: stops[minimum!] })).toBeNull();
  });
  it("이동 애니메이션 중 시작한 작은 아래 당기기도 한 단계만 내림", () => {
    const stops = sheetStops(844);
    expect(settleSheet(640, 0, stops, { stop: 1, height: 650 })).toBe(0);
  });
  it("반대 방향으로 돌아온 손가락의 마지막 속도만으로 단계를 건너뛰지 않음", () => {
    const stops = sheetStops(844);
    expect(settleSheet(stops[2] + 10, 3, stops, { stop: 2, height: stops[2] })).toBe(1);
  });
});

describe("상세 내용 스크롤과 시트 내리기 구분", () => {
  it("맨 위에서 아래로 당길 때만 시트가 제스처를 이어받음", () => {
    expect(contentPullDecision(0, 2, 40)).toBe("sheet");
    expect(contentPullDecision(-3, 2, 40)).toBe("sheet");
    expect(contentPullDecision(.5, 2, 40)).toBe("sheet");
  });
  it("본문이 아직 스크롤되어 있으면 본문을 먼저 올림", () => {
    expect(contentPullDecision(40, 0, 80)).toBe("scroll");
  });
  it("위 방향이나 가로 방향 스크롤을 빼앗지 않음", () => {
    expect(contentPullDecision(0, 0, -40)).toBe("scroll");
    expect(contentPullDecision(0, 40, 5)).toBe("scroll");
    expect(contentPullDecision(0, 30, 30)).toBe("scroll");
  });
  it("탭의 작은 흔들림으로 시트가 움직이지 않음", () => {
    expect(contentPullDecision(0, 2, 3)).toBe("pending");
  });
});
