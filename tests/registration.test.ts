import { describe, expect, it } from "vitest";
import { addFailure, aiIssueCopy, confirmPlan, initialChoice, instagramLinkIn, linkTail, rowState, searchSuggestions, selectionsToSend, type RowChoice, type RowInput } from "@/lib/registration";
import { parseJustSaved, placeIdFrom } from "@/lib/saved-memory";
import { pendingReason, pendingTitle, pendingWhen } from "@/lib/pending-source";
import type { KakaoPlace } from "@/lib/types";

const P = (id: string, name = id): KakaoPlace => ({ kakao_place_id: id, name, address: `${name} 주소`, lat: 37.5, lng: 127, category: "식당", kakao_url: "" });
const choicesFor = (rows: RowInput[]) => Object.fromEntries(rows.map((r) => [r.id, initialChoice(r)])) as Record<string, RowChoice>;

describe("장소 확인 상태: 장소마다 상태 하나", () => {
  const ding: RowInput = { id: "ding", name: "딩티엔 용산점", candidates: [] };
  const onion: RowInput = { id: "onion", name: "어니언 성수", candidates: [P("k1")] };
  const blue: RowInput = { id: "blue", name: "블루보틀", candidates: [P("b1"), P("b2"), P("b3")] };

  it("후보 하나는 위치 확인됨, 여러 곳은 지점 고르기, 없으면 못 찾음, 뺀 곳은 뺌", () => {
    const c = choicesFor([ding, onion, blue]);
    expect(rowState(onion, c.onion)).toBe("ready");
    expect(rowState(blue, c.blue)).toBe("choose");
    expect(rowState(ding, c.ding)).toBe("missing");
    expect(rowState(onion, { ...c.onion, excluded: true })).toBe("excluded");
    expect(rowState(onion, initialChoice({ ...onion, excluded: true }))).toBe("excluded");
  });

  it("딩티엔 사례: 지도 후보가 없는 식당은 조용히 빠지지 않고, 저장 요청도 만들지 않음", () => {
    const rows = [ding];
    const c = choicesFor(rows);
    expect(confirmPlan(rows, c)).toMatchObject({ ready: 0, remaining: 1, next: { kind: "find", id: "ding", name: "딩티엔 용산점" } });
    expect(selectionsToSend(rows, c)).toBeNull();
  });

  it("이름으로 찾아 고르면 그 장소만 준비되고 요청에는 검색어·페이지가 함께 감", () => {
    const rows = [ding, blue];
    const c = choicesFor(rows);
    const found = { ...P("d9", "딩티엔 용산아이파크몰점"), search_page: 2 };
    c.ding = { ...c.ding, extra: [found], pickedId: "d9", queries: { d9: "딩티엔 용산" } };
    expect(rowState(ding, c.ding)).toBe("ready");
    expect(rowState(blue, c.blue)).toBe("choose");
    expect(confirmPlan(rows, c).next).toEqual({ kind: "choose", id: "blue", name: "블루보틀" });
    c.blue = { ...c.blue, pickedId: "b2" };
    const plan = confirmPlan(rows, c);
    expect(plan.next).toEqual({ kind: "save", count: 2 });
    expect(selectionsToSend(rows, c)).toEqual([
      { extraction_id: "ding", include: true, place: found, place_id: "d9", page: 2, query: "딩티엔 용산" },
      { extraction_id: "blue", include: true, place: P("b2"), place_id: "b2", page: undefined, query: undefined },
    ]);
  });

  it("요청은 화면의 '준비됨'과 정확히 같음: 뺀 곳은 include:false, 준비된 곳만 include:true", () => {
    const rows = [onion, blue, ding];
    const c = choicesFor(rows);
    c.blue = { ...c.blue, excluded: true, pickedId: "b1" }; // 골랐다가 뺀 곳도 담기지 않음
    c.ding = { ...c.ding, excluded: true };
    const sent = selectionsToSend(rows, c)!;
    expect(sent.filter((s) => s.include).map((s) => s.extraction_id)).toEqual(["onion"]);
    expect(sent.find((s) => s.extraction_id === "blue")).toMatchObject({ include: false, place: null, place_id: null });
    expect(confirmPlan(rows, c)).toMatchObject({ ready: 1, remaining: 0, excluded: 2, next: { kind: "save", count: 1 } });
  });

  it("여럿 남으면 첫 번째 남은 장소로, 모두 빼면 0곳 저장 요청이 없음", () => {
    const rows = [onion, blue, ding];
    const c = choicesFor(rows);
    expect(confirmPlan(rows, c).next).toEqual({ kind: "remaining", count: 2, id: "blue" });
    const all = Object.fromEntries(rows.map((r) => [r.id, { ...initialChoice(r), excluded: true }]));
    expect(confirmPlan(rows, all).next).toEqual({ kind: "empty" });
    expect(selectionsToSend(rows, all)).toBeNull();
  });

  it("빼기를 되돌리면 전에 고른 지점이 그대로", () => {
    const c = initialChoice(blue);
    const picked = { ...c, pickedId: "b3" };
    expect(rowState(blue, { ...picked, excluded: true })).toBe("excluded");
    expect(rowState(blue, { ...picked, excluded: false })).toBe("ready");
  });

  it("다른 검색어 제안은 지금 검색어와 겹치지 않음", () => {
    expect(searchSuggestions("딩티엔", "용산점", "용산", "용산 딩티엔 용산점")).toEqual(["딩티엔", "용산 딩티엔", "딩티엔 용산점"]);
    expect(searchSuggestions("어니언", null, null, "어니언")).toEqual([]);
  });
});

describe("/add 결과를 원인별로", () => {
  it("이동하는 결과는 실패가 아님, 나머지는 원인별", () => {
    for (const status of ["saved", "duplicate", "confirm", "needs_review"]) expect(addFailure({ status, message: "" })).toBeNull();
    expect(addFailure({ status: "needs_caption", message: "", source_id: "s" })).toBe("unreadable");
    expect(addFailure({ status: "busy", message: "" })).toBe("busy");
    expect(addFailure({ status: "error", message: "", code: "gemini_rate_limit", source_id: "s" })).toBe("ai_wait");
    expect(addFailure({ status: "error", message: "", code: "gemini_free_daily_quota", source_id: "s" })).toBe("ai_limit");
    expect(addFailure({ status: "error", code: "not_instagram", message: "인스타그램 게시물이나 릴스 링크가 아니에요." })).toBe("not_instagram");
    expect(addFailure({ status: "error", code: "trashed", message: "" })).toBe("trashed");
    // 분석 전에 서버·연결이 실패하면(source_id 없음) 링크 오류가 아니라 서버 오류로 보여 줍니다.
    expect(addFailure({ status: "error", message: "장소 저장에 실패했어요. 잠시 후 다시 시도해 주세요." })).toBe("server");
    expect(addFailure({ status: "error", code: "server", message: "" })).toBe("server");
    expect(addFailure({ status: "error", message: "연결이 끊겼어요", source_id: "s" })).toBe("failed");
  });
  it("AI 실패 안내에는 서비스 이름이 없음", () => {
    for (const code of ["gemini_rate_limit", "gemini_unavailable", "gemini_auth", "gemini_daily_quota", "gemini_free_quota"]) {
      const copy = aiIssueCopy(code)!;
      expect(`${copy.title}${copy.body}`).not.toMatch(/Gemini|gemini/);
    }
    expect(aiIssueCopy("interrupted")).toBeNull();
  });
  it("붙여넣은 글에서 인스타 주소만, 링크 끝부분 표시", () => {
    expect(instagramLinkIn("이거 봐 https://www.instagram.com/reel/Dex5LUzTYz1/?igsh=abc 대박")).toBe("https://www.instagram.com/reel/Dex5LUzTYz1/?igsh=abc");
    expect(instagramLinkIn("https://naver.com")).toBeNull();
    expect(linkTail("https://www.instagram.com/reel/Dex5LUzTYz1/?igsh=abc")).toBe("reel/Dex5LUzTYz1");
  });
});

describe("방금 담은 곳 기억", () => {
  const raw = (over: object = {}) => JSON.stringify({ boardId: "b1", ids: ["p1", "p2"], url: "https://www.instagram.com/p/A/", at: 1000, ...over });
  it("같은 방·5분 안의 기록만 한 번 씀", () => {
    expect(parseJustSaved(raw(), "b1", 2000)).toMatchObject({ ids: ["p1", "p2"], url: "https://www.instagram.com/p/A/" });
    expect(parseJustSaved(raw(), "b2", 2000)).toBeNull();
    expect(parseJustSaved(raw(), "b1", 1000 + 6 * 60 * 1000)).toBeNull();
    expect(parseJustSaved(raw({ ids: [] }), "b1", 2000)).toBeNull();
    expect(parseJustSaved("{", "b1", 2000)).toBeNull();
  });
  it("원본 주소는 인스타만, 장소 id는 안전한 형식만", () => {
    expect(parseJustSaved(raw({ url: "javascript:alert(1)", ids: ["ok-1", "bad/../x"] }), "b1", 2000)).toEqual({ boardId: "b1", ids: ["ok-1"], url: null, at: 1000 });
    expect(placeIdFrom("/?place=abc-1")).toBe("abc-1");
    expect(placeIdFrom("/")).toBeNull();
  });
});

describe("확인 대기: 실제로 저장된 정보로만 남은 이유", () => {
  const base = { id: "s", url: "https://www.instagram.com/reel/C9xA2pLq/", shared_by: "지현", shared_at: "2026-11-25T05:02:00.000Z", analysis_version: "v" };
  it("이유와 다음 행동", () => {
    expect(pendingReason({ ...base, status: "needs_caption" })).toMatchObject({ text: "게시물 내용을 읽지 못했어요", action: { kind: "dismiss", label: "이 링크 정리" }, quiet: { kind: "retry", label: "다시 읽어 보기" } });
    expect(pendingReason({ ...base, status: "needs_review", recovery_reason: "gemini_rate_limit" })).toMatchObject({ action: { kind: "retry", label: "다시 분석" }, quiet: { kind: "dismiss", label: "저장할 곳 없음" } });
    expect(pendingReason({ ...base, status: "needs_review", recovery_reason: "gemini_daily_quota" })).toMatchObject({ text: "AI 분석 한도에 걸렸어요", action: { kind: "confirm" } });
    expect(pendingReason({ ...base, status: "needs_review", recovery_reason: "interrupted" })).toMatchObject({ action: { kind: "retry" } });
    expect(pendingReason({ ...base, status: "pending_confirm", place_names: ["딩티엔"], missing_count: 1, choose_count: 1 }).text).toBe("지도에서 못 찾은 곳이 1곳 있어요");
    expect(pendingReason({ ...base, status: "pending_confirm", place_names: ["블루보틀"], choose_count: 2 }).text).toBe("지점을 골라야 하는 곳이 2곳 있어요");
    expect(pendingReason({ ...base, status: "needs_review", place_names: [] }).text).toBe("게시물에서 장소 이름을 못 찾았어요");
  });
  it("이름이 없으면 링크 끝부분, 시간은 오늘·어제", () => {
    expect(pendingTitle({ ...base, status: "needs_review" })).toBe("reel/C9xA2pLq");
    expect(pendingTitle({ ...base, status: "pending_confirm", place_names: ["딩티엔", "어니언"] })).toBe("딩티엔 외 1곳");
    const now = new Date(2026, 10, 25, 20, 0);
    expect(pendingWhen(new Date(2026, 10, 25, 14, 2).toISOString(), now)).toBe("오늘 14:02");
    expect(pendingWhen(new Date(2026, 10, 24, 21, 15).toISOString(), now)).toBe("어제 21:15");
    expect(pendingWhen(undefined, now)).toBe("");
  });
});

describe("링크 입력 미리 확인(2026-11-25 점검 엣지 케이스)", () => {
  it("글 속 링크는 골라내고, 인스타가 아니거나 계정 주소면 이유를 돌려준다", async () => {
    const { postLinkIn } = await import("@/lib/registration");
    expect(postLinkIn("여기 꼭 가보자!! https://www.instagram.com/p/AbC_1-2/?igsh=xx 진짜")).toEqual({ link: "https://www.instagram.com/p/AbC_1-2/?igsh=xx" });
    expect(postLinkIn("https://instagram.com/reels/XyZ123/")).toEqual({ link: "https://instagram.com/reels/XyZ123/" });
    expect(postLinkIn("https://naver.me/5abcdEFG")).toEqual({ problem: "not_instagram" });
    expect(postLinkIn("https://www.instagram.com/newatdawn/")).toEqual({ problem: "not_post" });
    expect(postLinkIn("https://www.instagram.com/p/")).toEqual({ problem: "cut_off" });
    expect(postLinkIn("https://www.instagram.com/reel")).toEqual({ problem: "cut_off" });
    expect(postLinkIn("https://www.instagram.com/stories/newatdawn/3412345678901234567?igsh=x")).toEqual({ problem: "story" });
    expect(postLinkIn("https://www.instagram.com/s/aGlnaGxpZ2h0OjE3?story_media_id=1")).toEqual({ problem: "story" });
    expect(postLinkIn("https://www.instagram.com/explore/tags/성수맛집/")).toEqual({ problem: "not_post_page" });
    expect(postLinkIn("https://www.instagram.com/share/reel/BAabc123/")).toEqual({ link: "https://www.instagram.com/share/reel/BAabc123/" });
    expect(postLinkIn("안녕하세요")).toEqual({ problem: "not_instagram" });
  });
});

describe("지점 자동 선택(2026-11-25 실사용 테스트)", () => {
  const k = (id: string, name: string, category = "음식점"): KakaoPlace => ({ kakao_place_id: id, name, address: "", lat: 37.5, lng: 127, category, kakao_url: "" });
  it("캡션 이름과 똑같은 후보가 하나면 바로 고르고, 업종으로는 거르지 않는다", async () => {
    const { autoPick } = await import("@/lib/registration");
    expect(autoPick({ id: "1", name: "고로고로 성수", candidates: [k("a", "고로고로 성수"), k("b", "고로고로", "의류판매"), k("c", "고로고로 용산")] })).toBe("a");
    expect(autoPick({ id: "2", name: "고로고로성수", candidates: [k("a", "고로고로 성수"), k("c", "고로고로 용산")] })).toBe("a");
    expect(autoPick({ id: "3", name: "규엔당", candidates: [k("a", "규엔당 성수본점"), k("b", "규엔당 선릉점")] })).toBeNull();
    expect(autoPick({ id: "4", name: "오츠", candidates: [k("a", "오츠", "의류판매"), k("b", "오츠", "음식점")] })).toBeNull();
    expect(autoPick({ id: "5", name: "카페", candidates: [k("a", "다른 곳")] })).toBe("a");
  });
});
