/** Safe, stable reasons persisted with a link. Never store provider error bodies. */
export const ANALYSIS_MESSAGES = {
  gemini_free_daily_quota: "Gemini 무료 분석의 하루 사용량을 모두 사용했어요. 할당량이 초기화된 뒤 다시 시도하거나 장소를 직접 검색해 주세요.",
  gemini_daily_quota: "Gemini 분석의 하루 사용 한도에 도달했어요. 할당량이 초기화된 뒤 다시 시도하거나 장소를 직접 검색해 주세요.",
  gemini_free_quota: "Gemini 무료 분석 사용 한도에 걸렸어요. 잠시 후 다시 시도하거나 장소를 직접 검색해 주세요.",
  gemini_rate_limit: "Gemini 분석 요청이 잠시 몰려 제한됐어요. 잠시 후 다시 시도하거나 장소를 직접 검색해 주세요.",
  gemini_quota: "Gemini 분석 사용 한도에 걸렸어요. 정확한 제한 종류는 확인되지 않았어요. 나중에 다시 시도하거나 장소를 직접 검색해 주세요.",
  gemini_auth: "지금은 AI 장소 분석을 사용할 수 없어요. 장소를 직접 검색해 저장할 수 있어요.",
  gemini_unavailable: "Gemini 분석 서비스가 일시적으로 응답하지 못했어요. 잠시 후 다시 시도하거나 장소를 직접 검색해 주세요.",
} as const;
export type AnalysisIssue = keyof typeof ANALYSIS_MESSAGES;
export function analysisMessage(reason?: string | null): string | undefined {
  return reason && Object.hasOwn(ANALYSIS_MESSAGES, reason) ? ANALYSIS_MESSAGES[reason as AnalysisIssue] : undefined;
}
export class AnalysisError extends Error {
  constructor(public code: AnalysisIssue) { super(ANALYSIS_MESSAGES[code]); this.name = "AnalysisError"; }
}

export function geminiFailure(status: number, payload: unknown): AnalysisError {
  const error = (payload as { error?: { status?: string; message?: string; details?: unknown[] } })?.error;
  if (status === 429) {
    // QuotaFailure quotaId identifies daily vs per-minute limits. A 429 alone does not.
    const evidence = JSON.stringify(error ?? {}).slice(0, 30000);
    const free = /free[_ -]?tier/i.test(evidence);
    const daily = /per[_ -]?day|daily|quota_exceeded/i.test(evidence);
    const minute = /per[_ -]?minute|per[_ -]?second|rate_limit_exceeded|too_many_requests/i.test(evidence);
    if (daily) return new AnalysisError(free ? "gemini_free_daily_quota" : "gemini_daily_quota");
    if (minute) return new AnalysisError("gemini_rate_limit");
    return new AnalysisError(free ? "gemini_free_quota" : "gemini_quota");
  }
  return new AnalysisError(status === 401 || status === 403 ? "gemini_auth" : "gemini_unavailable");
}

/** Daily/auth limits are not fixed by adding more AI input. */
export function analysisRecovery(reason?: string | null): "search" | "retry" {
  return reason === "gemini_rate_limit" || reason === "gemini_unavailable" || reason === "interrupted" ? "retry" : "search";
}
export function analysisSummary(reason?: string | null): string | undefined {
  if (!analysisMessage(reason)) return undefined;
  if (reason === "gemini_free_daily_quota" || reason === "gemini_daily_quota") return "Gemini 하루 분석 한도를 모두 사용했어요.";
  if (reason === "gemini_rate_limit") return "Gemini 요청이 잠시 제한됐어요.";
  if (reason === "gemini_auth") return "AI 분석을 사용할 수 없어요.";
  if (reason === "gemini_unavailable") return "AI 분석이 잠시 응답하지 못했어요.";
  return "Gemini 분석 사용 한도에 걸렸어요.";
}
