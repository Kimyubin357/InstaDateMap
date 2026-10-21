import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, reset, tables } from "./fakeDb";

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

import { confirmSelections, ingestShare } from "@/lib/pipeline";
import { fetchCaption } from "@/lib/instagram";

process.env.APP_BASE_URL = "https://app.test";
const llmFor = (names: string[]) => async () =>
  JSON.stringify({ places: names.map((n) => ({ name: n, confidence: 0.9 })) });

beforeEach(() => {
  reset();
  tables.boards = [{ id: "b1", name: "우리", token: "tok" }];
});

const base = { boardId: "b1", token: "tok", who: "민지" };

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
    expect(r.confirm_url).toBe(`https://app.test/confirm/${r.source_id}?t=tok&who=%EB%AF%BC%EC%A7%80`);
    expect(tables.extractions).toHaveLength(3);

    const [onion, bread, none] = ["어니언", "자연도소금빵", "없는집"].map((n) => tables.extractions.find((e) => e.raw_name === n)!);
    const saved = await confirmSelections("b1", r.source_id!, "민지", [
      { extraction_id: onion.id, include: false, place: onion.candidates[0] }, // 추리기에서 뺌
      { extraction_id: bread.id, include: true, place: bread.candidates[1] }, // 익선점 선택
      { extraction_id: none.id, include: false, place: null },
    ]);
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
