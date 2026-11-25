import { describe, expect, it } from "vitest";
import { distanceLabel, openState, todayHours } from "@/lib/place-brief";
import type { PlaceHours } from "@/lib/naver-place";

// 한국 시간 기준 시각을 만듭니다(UTC = KST - 9시간). 2026-11-26은 목요일.
const at = (hhmm: string, date = "2026-11-26") => new Date(`${date}T${hhmm}:00+09:00`);
const week = (open: string | null, close: string | null, note: string | null = null): PlaceHours => ({ status: null, description: null,
  days: ["월", "화", "수", "목", "금", "토", "일"].map((day) => ({ day, open, close, breaks: [], note })) });

describe("리스트의 영업 표시", () => {
  it("오늘 요일 줄을 고르고, 없으면 평일/주말 → 매일", () => {
    expect(todayHours(week("10:00", "20:00"), at("12:00"))?.day).toBe("목");
    expect(todayHours({ status: null, description: null, days: [{ day: "평일", open: "09:00", close: "18:00", breaks: [], note: null }] }, at("12:00"))?.day).toBe("평일");
    expect(todayHours({ status: null, description: null, days: [{ day: "매일", open: "09:00", close: "18:00", breaks: [], note: null }] }, at("12:00"))?.day).toBe("매일");
    expect(todayHours(null)).toBeNull();
  });
  it("영업 전 · 영업 중 · 영업 종료 · 오늘 휴무 · 24시간 · 자정 넘김", () => {
    expect(openState(week("11:30", "21:00"), at("10:00"))).toEqual({ label: "영업 전", tone: "before", time: "11:30~21:00" });
    expect(openState(week("11:30", "21:00"), at("12:00"))?.label).toBe("영업 중");
    expect(openState(week("11:30", "21:00"), at("22:00"))?.label).toBe("영업 종료");
    expect(openState(week(null, null, "정기휴무"), at("12:00"))).toEqual({ label: "오늘 휴무", tone: "closed", time: "" });
    expect(openState({ status: null, description: null, days: [{ day: "매일", open: "00:00", close: "24:00", breaks: [], note: null }] }, at("03:00"))).toEqual({ label: "영업 중", tone: "open", time: "24시간" });
    expect(openState(week("18:00", "02:00"), at("01:00"))?.label).toBe("영업 중");
    expect(openState(week("18:00", "02:00"), at("15:00"))?.label).toBe("영업 전");
    expect(openState(week(null, null), at("12:00"))).toBeNull();
  });
  it("거리 글자", () => {
    expect(distanceLabel(240)).toBe("240m");
    expect(distanceLabel(1234)).toBe("1.2km");
    expect(distanceLabel(139_400)).toBe("139km");
  });
});
