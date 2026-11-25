import type { PlaceStatus } from "./types";
import { PLACE_STATUS_ENABLED } from "@/lib/features";
export const NEW_PLACE_WINDOW = 24 * 60 * 60 * 1000;
/**
 * Only the original registration date counts; duplicate saves and restores don't reset it.
 * 2026-11-25: NEW ends as soon as I view the place (its card or detail, `seen`), or 24 hours after registration if I never do.
 * "Seen" is per person (020_place_seen.sql, with this device's record as a fallback). The saver's own places stay NEW for them too, as before.
 * While statuses are shown, a place stays NEW only while it is still "가고 싶음".
 */
export function isNewPlace(createdAt: string, now: number, status: PlaceStatus = "wish", seen = false) {
  if (seen) return false;
  if (PLACE_STATUS_ENABLED && status !== "wish") return false;
  const created = Date.parse(createdAt);
  return Number.isFinite(created) && created <= now && now < created + NEW_PLACE_WINDOW;
}

/** 이 기기의 "본 장소" 기록(서버 기록 020을 쓰지 못할 때도 NEW가 사라지도록). 이틀 지난 기록은 버립니다. */
const SEEN_KEEP = 2 * NEW_PLACE_WINDOW;
export type SeenLog = Record<string, number>;
export function pruneSeen(log: SeenLog, now: number): SeenLog {
  return Object.fromEntries(Object.entries(log).filter(([id, at]) => typeof id === "string" && Number.isFinite(at) && now - at < SEEN_KEEP));
}
export function readSeenLog(userId: string, now = Date.now()): SeenLog {
  try {
    const value = JSON.parse(localStorage.getItem(`datemap-seen:${userId}`) || "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? pruneSeen(value, now) : {};
  } catch { return {}; }
}
export function writeSeenLog(userId: string, log: SeenLog) {
  try { localStorage.setItem(`datemap-seen:${userId}`, JSON.stringify(log)); } catch { /* 저장소가 막혀도 이번 화면에서는 사라집니다. */ }
}
