import type { PlaceHours, PlaceHoursDay } from "./naver-place";

/** 리스트 한 줄에 쓰는 가게 정보: 대표 사진 한 장과 영업시간(네이버 가게 정보 캐시, place_details). */
export interface PlaceBrief { photo: string | null; hours: PlaceHours | null }
export interface BriefsResponse { briefs: Record<string, PlaceBrief | null>; pending: string[] }

const DAYS = ["일", "월", "화", "수", "목", "금", "토"];
const minutes = (t: string | null) => {
  const m = t?.match(/^(\d{1,2}):(\d{2})$/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/** 오늘(한국 시간)에 해당하는 요일 줄: 그 요일 → 평일/주말 → 매일 순서로 찾습니다. */
export function todayHours(hours: PlaceHours | null, now = new Date()): PlaceHoursDay | null {
  if (!hours?.days.length) return null;
  const kst = new Date(now.getTime() + (9 * 60 + now.getTimezoneOffset()) * 60e3);
  const day = DAYS[kst.getDay()], weekend = day === "토" || day === "일";
  return hours.days.find((d) => d.day === day || d.day.startsWith(day))
    ?? hours.days.find((d) => d.day === (weekend ? "주말" : "평일"))
    ?? hours.days.find((d) => d.day === "매일") ?? null;
}

export type OpenTone = "open" | "before" | "closed";
/**
 * 리스트의 영업 표시: "영업 중 08:00~22:00"(초록) · "영업 전 11:30~21:00"(주황) · "영업 종료 10:00~19:00"(회색) · "오늘 휴무"(회색).
 * 요일 정보가 없으면 null(그 줄을 뺍니다). 자정을 넘기는 영업(18:00~02:00)과 24시간도 다룹니다.
 */
export function openState(hours: PlaceHours | null, now = new Date()): { label: string; tone: OpenTone; time: string } | null {
  const today = todayHours(hours, now);
  if (!today) return null;
  const open = minutes(today.open), close = minutes(today.close);
  if (open === null || close === null) return today.note ? { label: "오늘 휴무", tone: "closed", time: "" } : null;
  const time = `${today.open}~${today.close}`;
  if (open === 0 && close >= 24 * 60) return { label: "영업 중", tone: "open", time: "24시간" };
  const kst = new Date(now.getTime() + (9 * 60 + now.getTimezoneOffset()) * 60e3);
  const t = kst.getHours() * 60 + kst.getMinutes();
  const overnight = close <= open;
  const inside = overnight ? t >= open || t < close : t >= open && t < close;
  if (inside) return { label: "영업 중", tone: "open", time };
  if (!overnight && t < open) return { label: "영업 전", tone: "before", time };
  if (overnight && t < open && t >= close) return { label: "영업 전", tone: "before", time };
  return { label: "영업 종료", tone: "closed", time };
}

/** 거리 글자: 1km 미만은 m, 10km 미만은 소수 한 자리, 그 이상은 정수 km */
export function distanceLabel(m: number) {
  if (m < 1000) return `${Math.max(10, Math.round(m / 10) * 10)}m`;
  return m < 10_000 ? `${(m / 1000).toFixed(1)}km` : `${Math.round(m / 1000)}km`;
}
