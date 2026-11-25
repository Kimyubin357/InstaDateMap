/**
 * 처음 사용법(온보딩, 2026-11-25 시안 design-lab/onboarding).
 * 로그인·약관 동의 뒤 지도에 처음 들어오면 한 번 보여 줍니다. "봤음"은 계정에 남기고(021_onboarding.sql의 app_users.onboarded_at),
 * 021이 아직 없는 DB나 응답을 못 받은 경우에는 이 기기 기록(localStorage)으로 판단해 앱이 멈추지 않게 합니다.
 */

/** 환영 1장 + 코치마크 5장(점 6개) + 마무리 1장 */
export const ONBOARDING_STEPS = ["welcome", "copy", "plus", "room", "collections", "invite", "finish"] as const;
export type OnboardingStep = typeof ONBOARDING_STEPS[number];
/** 코치마크 단계(n / 5) */
export const COACH_STEPS: readonly OnboardingStep[] = ["copy", "plus", "room", "collections", "invite"];
export const coachNumber = (step: OnboardingStep) => COACH_STEPS.indexOf(step) + 1;

/** 서버 응답: true = 이 계정은 봤음, false = 아직, null = 알 수 없음(021 미적용·오류). */
export type ServerOnboarded = boolean | null;
/** 보여 줄지: 서버가 "봤음"이 아니고 이 기기에도 기록이 없을 때. */
export const shouldShowOnboarding = (server: ServerOnboarded, local: boolean) => server !== true && !local;
/** 이 기기에서는 봤는데(건너뛰기 저장이 실패했거나 021 적용 전) 서버에는 아직 없으면 조용히 다시 적습니다. */
export const needsServerMark = (server: ServerOnboarded, local: boolean) => server === false && local;

export const onboardingKey = (userId: string) => `datemap-onboarded:${userId}`;
export function readLocalOnboarded(userId: string, storage: Pick<Storage, "getItem"> | null = safeLocal()): boolean {
  try { return !!storage?.getItem(onboardingKey(userId)); } catch { return false; }
}
export function writeLocalOnboarded(userId: string, storage: Pick<Storage, "setItem"> | null = safeLocal()) {
  try { storage?.setItem(onboardingKey(userId), new Date().toISOString()); } catch { /* 저장소를 못 써도 서버 기록으로 판단합니다. */ }
}
function safeLocal(): Storage | null { try { return typeof window === "undefined" ? null : window.localStorage; } catch { return null; } }

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;
const defaultFetch: Fetcher = (input, init) => fetch(input, init);

/** 서버의 "봤음" 기록. 로그인 만료·오류·021 미적용은 모두 null(알 수 없음)입니다. */
export async function fetchOnboarded(fetcher: Fetcher = defaultFetch): Promise<ServerOnboarded> {
  try {
    const res = await fetcher("/api/onboarding", { cache: "no-store" });
    if (!res.ok) return null;
    const body = await res.json() as { onboarded?: unknown };
    return typeof body?.onboarded === "boolean" ? body.onboarded : null;
  } catch { return null; }
}
/** "봤음"을 계정에 적습니다. 서버에 남지 않았으면 false(이 기기 기록만 남음). */
export async function markOnboarded(fetcher: Fetcher = defaultFetch): Promise<boolean> {
  try {
    const res = await fetcher("/api/onboarding", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    if (!res.ok) return false;
    return (await res.json() as { stored?: unknown })?.stored === true;
  } catch { return false; }
}

/** 설정 → 사용법 다시 보기: 지도에 돌아가면 처음부터 보여 줍니다(지도는 계속 떠 있어 이벤트로 알립니다). */
export const ONBOARDING_REPLAY_EVENT = "datemap:onboarding-replay";
let replayPending = false;
export function requestOnboardingReplay() {
  replayPending = true;
  if (typeof window !== "undefined") window.dispatchEvent(new Event(ONBOARDING_REPLAY_EVENT));
}
export function takeOnboardingReplay() { const pending = replayPending; replayPending = false; return pending; }

/** 초대 링크로 들어온 사람: 환영 문구를 "○○님의 방에 들어왔어요"로 바꿉니다(한 번만 씀). */
export const INVITED_KEY = "datemap-invited";
export interface InvitedWelcome { owner: string | null; room: string | null }
export function rememberInvite(value: InvitedWelcome) {
  try { sessionStorage.setItem(INVITED_KEY, JSON.stringify(value)); } catch { /* 없어도 일반 환영 문구를 씁니다. */ }
}
export function takeInvite(): InvitedWelcome | null {
  try {
    const raw = sessionStorage.getItem(INVITED_KEY); sessionStorage.removeItem(INVITED_KEY);
    return parseInvite(raw);
  } catch { return null; }
}
export function parseInvite(raw: string | null): InvitedWelcome | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    const text = (x: unknown) => typeof x === "string" && x.trim() ? x.trim().slice(0, 40) : null;
    const value = { owner: text(v?.owner), room: text(v?.room) };
    return value.owner || value.room ? value : null;
  } catch { return null; }
}
/** 환영 카드 제목: 초대받은 사람은 방장 이름(없으면 방 이름)으로 */
export function welcomeTitle(invited: InvitedWelcome | null): { lead: string; em: string } {
  if (invited?.owner) return { lead: `${invited.owner}님의 방에`, em: "들어왔어요" };
  if (invited?.room) return { lead: `‘${invited.room}’ 방에`, em: "들어왔어요" };
  return { lead: "인스타에서 본 곳,", em: "지도에 모아요" };
}

/** 모음 안내의 예시 모음(이 방에 아직 모음이 없을 때). 실제 데이터가 아니라 예시로 표시합니다. */
export const EXAMPLE_COLLECTIONS = [
  { id: "example-1", name: "첫날", icon: "✈️", color: "teal", count: 4 },
  { id: "example-2", name: "둘째날", icon: "🌊", color: "blue", count: 3 },
  { id: "example-3", name: "셋째날", icon: "🍊", color: "orange", count: 5 },
] as const;
