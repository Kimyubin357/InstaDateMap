import type { KakaoPlace } from "./types";
import type { ShareResult } from "./share-stream";

/**
 * 장소 확인 화면의 상태 모델 (docs/place-registration-redesign.md, 시안 4–8번).
 * 체크박스 하나로 '이름 찾음 / 지도 연결 필요 / 담을 준비 / 뺌'을 표현하던 것을 장소마다 상태 하나로 나눕니다.
 *  - ready: 지도 지점이 정해짐(후보가 하나면 처음부터) → 담김
 *  - choose: 후보가 여러 곳이고 아직 고르지 않음 → 지점 고르기
 *  - missing: 지도 후보가 없음 → 이름으로 찾기
 *  - excluded: 사용자가 [빼기]를 누름 → 담지 않음
 * 저장 요청은 ready인 장소만 include로 보냅니다. 화면과 요청이 같은 함수(rowState)를 씁니다.
 */
export type RowState = "ready" | "choose" | "missing" | "excluded";
export interface RowInput { id: string; name: string; candidates: KakaoPlace[]; excluded?: boolean }
export interface RowChoice { excluded: boolean; pickedId: string | null; extra: KakaoPlace[]; queries: Record<string, string> }

export function initialChoice(row: RowInput): RowChoice {
  return { excluded: !!row.excluded, pickedId: row.candidates.length === 1 ? row.candidates[0].kakao_place_id : null, extra: [], queries: {} };
}

/** 저장된 후보 + 이름으로 찾아 고른 곳(같은 카카오 장소는 한 번만) */
export function rowOptions(row: RowInput, choice: RowChoice): KakaoPlace[] {
  const seen = new Set<string>();
  return [...row.candidates, ...choice.extra].filter((p) => !seen.has(p.kakao_place_id) && !!seen.add(p.kakao_place_id));
}

export function pickedPlace(row: RowInput, choice: RowChoice): KakaoPlace | null {
  return choice.pickedId ? rowOptions(row, choice).find((p) => p.kakao_place_id === choice.pickedId) ?? null : null;
}

export function rowState(row: RowInput, choice: RowChoice): RowState {
  if (choice.excluded) return "excluded";
  if (pickedPlace(row, choice)) return "ready";
  return row.candidates.length > 0 ? "choose" : "missing";
}

export type NextStep =
  | { kind: "save"; count: number }
  | { kind: "empty" }
  | { kind: "find" | "choose"; id: string; name: string }
  | { kind: "remaining"; count: number; id: string };

export interface ConfirmPlan { ready: number; remaining: number; excluded: number; next: NextStep }

/** 아래 버튼이 할 일: 모두 준비되면 담기, 하나 남으면 그 장소의 일, 여럿 남으면 첫 번째 남은 장소로. */
export function confirmPlan(rows: RowInput[], choices: Record<string, RowChoice>): ConfirmPlan {
  const states = rows.map((row) => ({ row, state: rowState(row, choices[row.id] ?? initialChoice(row)) }));
  const ready = states.filter((s) => s.state === "ready").length;
  const excluded = states.filter((s) => s.state === "excluded").length;
  const left = states.filter((s) => s.state === "choose" || s.state === "missing");
  const next: NextStep = left.length === 0 ? (ready ? { kind: "save", count: ready } : { kind: "empty" })
    : left.length === 1 ? { kind: left[0].state === "missing" ? "find" : "choose", id: left[0].row.id, name: left[0].row.name }
    : { kind: "remaining", count: left.length, id: left[0].row.id };
  return { ready, remaining: left.length, excluded, next };
}

export interface ConfirmSelection { extraction_id: string; include: boolean; place: KakaoPlace | null; place_id: string | null; page?: number; query?: string }

/**
 * 서버로 보낼 선택. ready만 include이고, 그 밖(뺌)은 include:false로 기록합니다.
 * 남은 장소(choose·missing)가 있으면 아무것도 보내지 않습니다(null): 조용히 빠지는 일을 막습니다.
 */
export function selectionsToSend(rows: RowInput[], choices: Record<string, RowChoice>): ConfirmSelection[] | null {
  const plan = confirmPlan(rows, choices);
  if (plan.next.kind !== "save") return null;
  return rows.map((row) => {
    const choice = choices[row.id] ?? initialChoice(row);
    const place = rowState(row, choice) === "ready" ? pickedPlace(row, choice) : null;
    return { extraction_id: row.id, include: !!place, place, place_id: place?.kakao_place_id ?? null, page: place?.search_page,
      query: place ? choice.queries[place.kakao_place_id] : undefined };
  });
}

/** 이름으로 찾기의 다른 검색어 제안(지금 검색어와 같은 것은 뺌) */
export function searchSuggestions(rawName: string, branch: string | null, areaHint: string | null, current: string): string[] {
  const values = [rawName, areaHint ? `${areaHint} ${rawName}` : "", branch ? `${rawName} ${branch}` : ""].map((v) => v.replace(/\s+/g, " ").trim());
  const now = current.replace(/\s+/g, " ").trim();
  return [...new Set(values)].filter((v) => v && v !== now).slice(0, 3);
}

/** /add에서 결과를 어디에 보여 줄지. 이동하지 않는 결과는 원인별 실패 화면(시안 10·11)으로. */
export type AddFailure = "unreadable" | "not_instagram" | "ai_wait" | "ai_limit" | "busy" | "failed";
export function addFailure(result: ShareResult): AddFailure | null {
  if (["saved", "duplicate", "confirm", "needs_review"].includes(result.status)) return null;
  if (result.status === "needs_caption") return "unreadable";
  if (result.status === "busy") return "busy";
  const code = result.code ?? "";
  if (code === "gemini_rate_limit" || code === "gemini_unavailable") return "ai_wait";
  if (code.startsWith("gemini_")) return "ai_limit";
  if (!result.source_id) return "not_instagram";
  return "failed";
}

/** 확인 대기·확인 화면에 쓸 AI 실패 안내(서비스 이름·원문 오류 없이). 코드가 AI 실패가 아니면 null. */
export function aiIssueCopy(code?: string | null): { title: string; body: string; retry: boolean } | null {
  if (!code?.startsWith("gemini_")) return null;
  if (code === "gemini_rate_limit" || code === "gemini_unavailable") return { title: "AI가 잠시 장소를 못 읽었어요", body: "분석 요청이 몰렸거나 잠시 응답이 없었어요. 1분쯤 뒤에 다시 해 보세요.", retry: true };
  if (code === "gemini_auth") return { title: "지금은 AI 분석을 쓸 수 없어요", body: "장소 이름을 알면 직접 찾아서 담을 수 있어요.", retry: false };
  return { title: "AI 분석 한도에 걸렸어요", body: "한도가 풀린 뒤에 다시 분석할 수 있어요. 장소 이름을 알면 지금 직접 찾아서 담을 수 있어요.", retry: false };
}

/** 인스타 주소 끝부분(p/…, reel/…)만. 링크 제목이 없을 때 보여 줍니다. */
export function linkTail(url: string) {
  return url.replace(/^https?:\/\/(www\.)?instagram\.com\//i, "").replace(/[?#].*$/, "").replace(/\/+$/, "") || url;
}
export function linkKind(url: string) {
  return /\/(reels?|tv)\//i.test(url) ? "인스타 릴스" : "인스타 게시물";
}
/** 붙여넣은 글에서 첫 인스타 주소(없으면 null) */
export function instagramLinkIn(text: string): string | null {
  const match = text.match(/https?:\/\/(?:www\.)?instagram\.com\/[^\s"'<>]+/i);
  return match ? match[0] : null;
}
