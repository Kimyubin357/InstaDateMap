import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, failNext, reset, tables } from "./fakeDb";

vi.mock("@/lib/db", () => ({ db: () => fakeDb }));
vi.mock("@/lib/instagram", async (orig) => {
  const real = await orig<typeof import("@/lib/instagram")>();
  return { ...real, fetchCaption: vi.fn(async () => ({ caption: null, method: null, locationTag: null })) };
});
vi.mock("@/lib/kakao", async (orig) => {
  const real = await orig<typeof import("@/lib/kakao")>();
  const P = (id: string, name: string) => ({ kakao_place_id: id, name, address: "서울 성동구", lat: 37.5, lng: 127, category: "카페", kakao_url: "" });
  const db: Record<string, any[]> = {
    어니언: [P("k1", "어니언 성수")],
    자연도소금빵: [P("k2", "자연도소금빵 성수"), P("k3", "자연도소금빵 익선")],
    없는집: [],
  };
  return { ...real, resolveCandidate: vi.fn(async (c: { name: string }) => db[c.name] ?? []) };
});

import { AnalysisError } from "@/lib/analysis-issue";
import { confirmSelections, ingestShare } from "@/lib/pipeline";
import { fetchCaption } from "@/lib/instagram";
import { resolveCandidate } from "@/lib/kakao";

process.env.APP_BASE_URL = "https://app.test";
const llmFor = (names: string[]) => async () =>
  JSON.stringify({ places: names.map((n) => ({ name: n, confidence: 0.9 })) });
const base = { boardId: "b1", token: "tok", owner: "tab-a", who: "민지" };

beforeEach(() => {
  reset();
  vi.clearAllMocks();
  tables.boards = [{ id: "b1", name: "우리", token: "tok" }];
});

describe("저장 실패와 재시도", () => {
  const input = { ...base, text: "https://www.instagram.com/p/AAA/", caption: "어니언" };

  it.each(["needs_caption", "needs_review", "pending_confirm"])("예전 %s 링크를 처음 다시 넣어도 상태에 맞는 보완 흐름으로 반환", async (status) => {
    tables.sources = [{ id: "s1", board_id: "b1", url: input.text, shared_by: "민지", status, work_owner: base.owner, work_until: new Date(Date.now()+90000).toISOString() }];
    const llm = vi.fn(llmFor(["어니언"]));
    const result = await ingestShare({ ...base, text: input.text }, llm);
    expect(result.status).toBe(status === "pending_confirm" ? "confirm" : status);
    expect(result.source_id).toBe("s1"); expect(result.confirm_url).toContain("/confirm/s1");
    expect(llm).not.toHaveBeenCalled(); expect(fetchCaption).not.toHaveBeenCalled();
  });

  it("삭제한 핀은 같은 링크를 다시 공유해서 복구", async () => {
    await ingestShare(input, llmFor(["어니언"]));
    tables.places = [];
    tables.source_places = [];
    const r = await ingestShare({ ...base, text: input.text }, llmFor(["어니언"]));
    expect(r.status).toBe("saved");
    expect(tables.places).toHaveLength(1);
    expect(tables.source_places).toHaveLength(1);
  });

  it("확인 대기 중인 링크도 명시적으로 재분석 가능", async () => {
    await ingestShare({ ...input, caption: "없는집" }, llmFor(["없는집"]));
    const r = await ingestShare({ ...base, text: input.text, retry: true }, llmFor(["어니언"]));
    expect(r.status).toBe("saved");
  });

  it("지역 위치 태그 때문에 장소 하나가 여러 장소로 바뀌지 않음", async () => {
    vi.mocked(fetchCaption).mockResolvedValueOnce({ caption: "어니언", method: "og", locationTag: "경기도 수원" });
    const r = await ingestShare({ ...base, text: input.text }, llmFor(["어니언"]));
    expect(r.status).toBe("saved");
    expect(tables.extractions).toHaveLength(1);
  });

  it("캡션 후보가 있어도 업로드한 스크린샷으로 다시 찾음", async () => {
    const llm = vi.fn(async (_system, content) => JSON.stringify({ places: [{ name: content.some((c: { type: string }) => c.type === "image") ? "어니언" : "없는집", confidence: 0.9 }] }));
    const r = await ingestShare({ ...input, images: [{ mediaType: "image/png", data: "test" }] }, llm);
    expect(llm).toHaveBeenCalledTimes(2);
    expect(r.status).toBe("confirm");
    expect(tables.extractions.some((e) => e.module === "image" && e.candidates.length)).toBe(true);
  });

  for (const [table, op] of [["source_places", "upsert"], ["extractions", "insert"], ["extractions", "delete"], ["sources", "update"], ["places", "upsert"]]) {
    it(`${table} ${op} 실패를 저장 성공으로 보고하지 않음`, async () => {
      failNext(table, op);
      const r = await ingestShare(input, llmFor(["어니언"]));
      expect(r.status).toBe("error");
      expect(r.confirm_url).toContain("/confirm/");
      expect(tables.sources[0].status).toBe("needs_review");
    });
  }

  it("캡션 없는 링크의 DB 저장 실패를 숨기지 않음", async () => {
    failNext("sources", "upsert");
    await expect(ingestShare({ ...base, text: input.text }, llmFor([]))).rejects.toThrow("링크 저장 실패");
  });

  it("AI 장애를 장소 정보 없음과 구분하고 재시도 가능하게 보존", async () => {
    const r = await ingestShare(input, async () => { throw new Error("quota"); });
    expect(r.status).toBe("error");
    expect(r.message).toContain("AI");
    expect(tables.sources[0].status).toBe("needs_review");
  });

  it("카카오 장애를 빈 검색 결과로 바꾸지 않음", async () => {
    vi.mocked(resolveCandidate).mockRejectedValueOnce(new Error("카카오 장소 검색 실패 (401)"));
    const r = await ingestShare(input, llmFor(["어니언"]));
    expect(r.status).toBe("error");
    expect(r.message).toContain("401");
  });

  it("다른 링크의 추출 후보를 연결하지 못함", async () => {
    const r = await ingestShare(input, llmFor(["자연도소금빵"]));
    tables.extractions.push({ id: "foreign", source_id: "other" });
    await expect(confirmSelections("b1", r.source_id!, "민지", [{ extraction_id: "foreign", include: true, place_id: tables.extractions[0].candidates[0].kakao_place_id }], null, base.owner, tables.sources[0].analysis_version)).rejects.toThrow("이 링크의 장소 후보");
    expect(tables.places ?? []).toHaveLength(0);
  });
});

describe("공유 → 저장 흐름", () => {
  it("캡션을 못 받으면 붙여넣기 요청", async () => {
    const r = await ingestShare({ ...base, text: "https://www.instagram.com/p/AAA/?igsh=1" }, llmFor([]));
    expect(r.status).toBe("needs_caption");
    expect(r.confirm_url).toContain("/confirm/");
    expect(tables.sources[0]).toMatchObject({ url: "https://www.instagram.com/p/AAA/", status: "needs_caption" });
  });

  it("장소 하나 + 후보 하나면 바로 저장", async () => {
    const r = await ingestShare({ ...base, text: "https://www.instagram.com/p/AAA/", caption: "📍어니언" }, llmFor(["어니언"]));
    expect(r.status).toBe("saved");
    expect(tables.places).toHaveLength(1);
    expect(tables.source_places[0]).toMatchObject({ added_by: "민지" });
    expect(tables.sources[0].status).toBe("done");
  });

  it("여러 곳이면 확인 화면, 추리기 후 고른 곳만 저장", async () => {
    vi.mocked(fetchCaption).mockResolvedValueOnce({ caption: "코스: 어니언, 자연도소금빵, 없는집", method: "og", locationTag: null });
    const r = await ingestShare({ ...base, text: "https://www.instagram.com/reel/RRR/" }, llmFor(["어니언", "자연도소금빵", "없는집"]));
    expect(r.status).toBe("confirm");
    expect(r.confirm_url).toBe(`https://app.test/confirm/${r.source_id}`);
    expect(tables.extractions).toHaveLength(3);

    const [onion, bread, none] = ["어니언", "자연도소금빵", "없는집"].map((n) => tables.extractions.find((e) => e.raw_name === n)!);
    const saved = await confirmSelections("b1", r.source_id!, "민지", [
      { extraction_id: onion.id, include: false, place_id: onion.candidates[0].kakao_place_id }, // 추리기에서 뺌
      { extraction_id: bread.id, include: true, place_id: bread.candidates[1].kakao_place_id }, // 익선점 선택
      { extraction_id: none.id, include: false, place_id: null },
    ], null, base.owner, tables.sources[0].analysis_version);
    expect(saved).toBe(1);
    expect(tables.places.map((p) => p.kakao_place_id)).toEqual(["k3"]);
    expect(onion.excluded).toBe(true);
    expect(tables.sources[0].status).toBe("done");
  });

  it("연인이 같은 링크를 또 공유하면 둘 다 저장함 기록", async () => {
    await ingestShare({ ...base, text: "https://www.instagram.com/p/AAA/", caption: "어니언" }, llmFor(["어니언"]));
    const r = await ingestShare({ ...base, who: "준호", text: "https://www.instagram.com/p/AAA/" }, llmFor(["어니언"]));
    expect(r.status).toBe("duplicate");
    expect(tables.places).toHaveLength(1);
    expect(new Set(tables.source_places.map((s) => s.added_by))).toEqual(new Set(["민지", "준호"]));
  });

  it("장소를 지도에서 못 찾으면 확인 필요", async () => {
    const r = await ingestShare({ ...base, text: "https://www.instagram.com/p/BBB/", caption: "없는집" }, llmFor(["없는집"]));
    expect(r.status).toBe("needs_review");
    expect(r.confirm_url).toContain("/confirm/");
  });

  it("인스타 링크가 아니면 에러", async () => {
    const r = await ingestShare({ ...base, text: "https://naver.com" }, llmFor([]));
    expect(r.status).toBe("error");
  });
});

describe("Gemini 사용 한도 안내", () => {
  it("무료 일일 한도를 대기함에 보존하고 같은 요청의 이미지 분석을 중단", async () => {
    const llm = vi.fn(async () => { throw new AnalysisError("gemini_free_daily_quota"); });
    const result = await ingestShare({ ...base, text: "https://www.instagram.com/p/QUOTA/", caption: "어니언", images: [{ mediaType: "image/png", data: "test" }] }, llm);
    expect(result).toMatchObject({ status: "error", code: "gemini_free_daily_quota" });
    expect(result.message).toContain("무료 분석의 하루 사용량");
    expect(tables.sources[0]).toMatchObject({ status: "needs_review", recovery_reason: "gemini_free_daily_quota" });
    expect(llm).toHaveBeenCalledTimes(1);
    const resumed = await ingestShare({ ...base, text: "https://www.instagram.com/p/QUOTA/" }, llm);
    expect(resumed.message).toBe(result.message); expect(resumed.code).toBe(result.code);
  });
  it("일부 후보가 나온 뒤 이미지 분석이 제한되면 자동 저장하지 않고 후보와 이유를 함께 보존", async () => {
    const llm = vi.fn().mockResolvedValueOnce(JSON.stringify({ places: [{ name: "어니언", confidence: 0.9 }] })).mockRejectedValueOnce(new AnalysisError("gemini_rate_limit"));
    const result = await ingestShare({ ...base, text: "https://www.instagram.com/p/PARTIAL/", caption: "어니언", images: [{ mediaType: "image/png", data: "test" }] }, llm);
    expect(result).toMatchObject({ status: "confirm", code: "gemini_rate_limit" });
    expect(tables.extractions).toHaveLength(1); expect(tables.places ?? []).toHaveLength(0);
    expect(tables.sources[0].recovery_reason).toBe("gemini_rate_limit");
  });
  it("삭제한 장소로 연결되는 링크는 재분석하지 않고 복구 위치 안내", async () => {
    const input = { ...base, text: "https://www.instagram.com/p/TRASH/", caption: "어니언" };
    await ingestShare(input, llmFor(["어니언"])); tables.places[0].deleted_at = new Date().toISOString();
    const llm = vi.fn(llmFor(["어니언"]));
    expect((await ingestShare(input, llm)).message).toContain("설정에서 복구"); expect(llm).not.toHaveBeenCalled();
  });
});
