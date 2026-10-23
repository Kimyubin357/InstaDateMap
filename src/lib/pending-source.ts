import type { PendingSource } from "./sync-types";
import { analysisRecovery } from "./analysis-issue";
export function pendingTitle(source: PendingSource) {
  const names = [...new Set((Array.isArray(source.place_names) ? source.place_names : []).filter((name) => typeof name === "string" && name.trim()))];
  if (names.length) return names.length > 1 ? `${names[0]} 외 ${names.length - 1}곳` : names[0];
  return source.recovery_reason === "interrupted" ? "분석이 중단된 링크" : "장소를 확인할 링크";
}
export function pendingAction(source: PendingSource) {
  if (source.status === "pending_confirm") return "지점 선택 필요";
  return analysisRecovery(source.recovery_reason) === "retry" ? "분석 다시 시도 · 직접 검색" : "장소 직접 검색";
}
export function pendingDate(value?: string) {
  return value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleDateString("ko-KR", { year: "numeric", month: "numeric", day: "numeric" }) : "";
}
