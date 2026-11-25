import type { PendingSource } from "./sync-types";
import { analysisRecovery } from "./analysis-issue";
import { linkTail } from "./registration";

/** 읽은 장소 이름(없으면 링크 끝부분) */
export function pendingTitle(source: PendingSource) {
  const names = [...new Set((Array.isArray(source.place_names) ? source.place_names : []).filter((name) => typeof name === "string" && name.trim()))];
  if (names.length) return names.length > 1 ? `${names[0]} 외 ${names.length - 1}곳` : names[0];
  return linkTail(source.url);
}

export type PendingNext = "confirm" | "retry" | "dismiss";
export interface PendingReason {
  /** 붉은 잉크 한 줄: 남은 이유 */
  text: string;
  icon: "search" | "pin" | "clock" | "lock" | "refresh";
  /** 오른쪽 알약 버튼(다음 행동 하나)과 그 아래 조용한 글자 버튼 */
  action: { kind: PendingNext; label: string };
  quiet: { kind: PendingNext; label: string };
}

/** 링크마다 남은 이유와 다음 행동. 링크 상태·이유 코드·후보 수처럼 실제로 저장된 정보만 씁니다. */
export function pendingReason(source: PendingSource): PendingReason {
  const reason = source.recovery_reason ?? null;
  const confirm = { kind: "confirm" as const, label: "이어서 확인" };
  const noPlace = { kind: "dismiss" as const, label: "저장할 곳 없음" };
  if (source.status === "needs_caption") return { text: "게시물 내용을 읽지 못했어요", icon: "lock", action: { kind: "dismiss", label: "이 링크 정리" }, quiet: { kind: "retry", label: "다시 읽어 보기" } };
  if (reason?.startsWith("gemini_")) {
    return analysisRecovery(reason) === "retry"
      ? { text: "AI 분석이 잠시 안 됐어요", icon: "clock", action: { kind: "retry", label: "다시 분석" }, quiet: noPlace }
      : { text: reason === "gemini_auth" ? "지금은 AI 분석을 쓸 수 없어요" : "AI 분석 한도에 걸렸어요", icon: "clock", action: confirm, quiet: noPlace };
  }
  if (reason === "interrupted") return { text: "분석이 중간에 멈췄어요", icon: "refresh", action: { kind: "retry", label: "다시 분석" }, quiet: noPlace };
  const missing = source.missing_count ?? 0, choose = source.choose_count ?? 0;
  if (missing > 0) return { text: `지도에서 못 찾은 곳이 ${missing}곳 있어요`, icon: "search", action: confirm, quiet: noPlace };
  if (choose > 0) return { text: `지점을 골라야 하는 곳이 ${choose}곳 있어요`, icon: "pin", action: confirm, quiet: noPlace };
  if (!source.place_names?.length) return { text: "게시물에서 장소 이름을 못 찾았어요", icon: "search", action: confirm, quiet: noPlace };
  return { text: "확인하고 담기만 남았어요", icon: "pin", action: confirm, quiet: noPlace };
}

/** '오늘 14:02' · '어제 21:15' · '11. 3.' */
export function pendingWhen(value?: string, now = new Date()) {
  if (!value || !Number.isFinite(Date.parse(value))) return "";
  const at = new Date(value);
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = Math.round((day(now) - day(at)) / 86400000);
  const time = at.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false });
  if (diff === 0) return `오늘 ${time}`;
  if (diff === 1) return `어제 ${time}`;
  return at.toLocaleDateString("ko-KR", at.getFullYear() === now.getFullYear() ? { month: "numeric", day: "numeric" } : { year: "numeric", month: "numeric", day: "numeric" });
}
