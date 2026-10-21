import { describe, expect, it } from "vitest";
import { candidatesFromLlm } from "@/lib/extract/normalize";
import { mergeCandidates } from "@/lib/extract/merge";
import { extractPlaces } from "@/lib/extract/router";
import type { ExtractorModule, PlaceCandidate, SourceContext } from "@/lib/extract/types";
import { captionModule } from "@/lib/extract/modules/caption";
import { locationTagModule } from "@/lib/extract/modules/locationTag";
import { imageModule } from "@/lib/extract/modules/image";

const ctx = (over: Partial<SourceContext> = {}): SourceContext => ({
  url: "https://www.instagram.com/p/A/",
  mediaType: "post",
  caption: null,
  locationTag: null,
  images: [],
  videos: [],
  ...over,
});

const cand = (name: string, confidence: number, module: PlaceCandidate["module"], over: Partial<PlaceCandidate> = {}): PlaceCandidate => ({
  name,
  branch: null,
  address: null,
  areaHint: null,
  category: null,
  confidence,
  evidence: "",
  module,
  ...over,
});

describe("LLM 응답 파싱", () => {
  it("코드펜스가 있어도 파싱, 이상한 값은 버림", () => {
    const text = '```json\n{"places":[{"name":"어니언","branch":"성수점","address":null,"area_hint":"성수","category":"카페","confidence":0.9,"evidence":"📍성수 카페 어니언"},{"name":"","confidence":1},{"name":"null"}]}\n```';
    const out = candidatesFromLlm(text, "caption");
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ name: "어니언", branch: "성수점", areaHint: "성수", confidence: 0.9, module: "caption" });
  });
  it("JSON이 아니면 빈 배열", () => {
    expect(candidatesFromLlm("죄송합니다", "caption")).toEqual([]);
  });
});

describe("후보 병합", () => {
  it("같은 상호는 하나로, 두 모듈이 맞으면 신뢰도 상승", () => {
    const merged = mergeCandidates([
      cand("어니언", 0.7, "caption", { branch: "성수점", areaHint: "성수" }),
      cand("어니언", 0.85, "location_tag"),
      cand("자연도소금빵", 0.6, "caption"),
    ]);
    expect(merged).toHaveLength(2);
    expect(merged[0].name).toBe("어니언");
    expect(merged[0].branch).toBe("성수점");
    expect(merged[0].confidence).toBeCloseTo(0.95);
    expect(merged[1].name).toBe("자연도소금빵");
  });
  it("지점이 다르면 따로", () => {
    const merged = mergeCandidates([
      cand("블루보틀", 0.8, "caption", { branch: "성수점" }),
      cand("블루보틀", 0.8, "caption", { branch: "삼청점" }),
    ]);
    expect(merged).toHaveLength(2);
  });
});

describe("라우터", () => {
  const fake = (name: PlaceCandidate["module"], cost: "cheap" | "heavy", result: PlaceCandidate[], log: string[]): ExtractorModule => ({
    name,
    cost,
    enabled: true,
    canRun: () => true,
    run: async () => {
      log.push(name);
      return result;
    },
  });

  it("가벼운 모듈 결과가 충분하면 무거운 모듈은 건너뜀", async () => {
    const log: string[] = [];
    const r = await extractPlaces(ctx(), { llm: async () => "" }, [
      fake("caption", "cheap", [cand("A", 0.9, "caption")], log),
      fake("image", "heavy", [cand("B", 0.9, "image")], log),
    ]);
    expect(log).toEqual(["caption"]);
    expect(r.candidates.map((c) => c.name)).toEqual(["A"]);
  });

  it("부족하면 무거운 모듈 실행", async () => {
    const log: string[] = [];
    const r = await extractPlaces(ctx(), { llm: async () => "" }, [
      fake("caption", "cheap", [cand("A", 0.3, "caption")], log),
      fake("image", "heavy", [cand("B", 0.8, "image")], log),
      fake("video", "heavy", [cand("C", 0.8, "video")], log),
    ]);
    expect(log).toEqual(["caption", "image"]); // 이미지로 충분해져서 영상은 안 돎
    expect(r.candidates[0].name).toBe("B");
  });

  it("모듈 하나가 실패해도 나머지 결과는 살림", async () => {
    const broken: ExtractorModule = {
      name: "location_tag",
      cost: "cheap",
      enabled: true,
      canRun: () => true,
      run: async () => {
        throw new Error("boom");
      },
    };
    const r = await extractPlaces(ctx(), { llm: async () => "" }, [broken, fake("caption", "cheap", [cand("A", 0.9, "caption")], [])]);
    expect(r.candidates).toHaveLength(1);
    expect(r.errors[0].module).toBe("location_tag");
  });

  it("실제 모듈 조합: 캡션 + 위치 태그, 스크린샷은 필요할 때만", async () => {
    const calls: string[] = [];
    const llm = async (system: string) => {
      calls.push(system.includes("사진") ? "image" : "caption");
      return system.includes("사진")
        ? '{"places":[{"name":"간판집","confidence":0.8}]}'
        : '{"places":[{"name":"어니언","branch":"성수점","area_hint":"성수","confidence":0.9}]}';
    };
    const r = await extractPlaces(
      ctx({ caption: "📍어니언 성수점", locationTag: "어니언 성수점", images: [{ mediaType: "image/png", data: "x" }] }),
      { llm },
      [locationTagModule, captionModule, imageModule],
    );
    expect(calls).toEqual(["caption"]);
    expect(r.candidates).toHaveLength(1);
    expect(r.candidates[0]).toMatchObject({ name: "어니언", branch: "성수점" });
  });
});
