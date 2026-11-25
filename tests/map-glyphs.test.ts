import { describe, expect, it } from "vitest";
import { MAP_GLYPHS, mapGlyph, mapGlyphSvg } from "@/lib/map-glyphs";

describe("지도 핀 분류 아이콘", () => {
  it("카카오 분류로 고르고, 음식점은 가게 이름으로 세부를 보충", () => {
    expect(mapGlyph("카페", "어니언 성수")).toBe("cafe");
    expect(mapGlyph("음식점", "도디치 피자")).toBe("pizza");
    expect(mapGlyph("음식점", "60계치킨")).toBe("chicken");
    expect(mapGlyph("음식점", "말방국밥")).toBe("restaurant");
    expect(mapGlyph("목욕탕,사우나", "")).toBe("spa");
    expect(mapGlyph("찜질방", "")).toBe("spa");
    expect(mapGlyph("관광,명소", "삼성궁")).toBe("tourist_spot");
    expect(mapGlyph("즉석사진", "")).toBe("studio");
    expect(mapGlyph("의류판매", "")).toBe("fashion");
    expect(mapGlyph(null, "아무개")).toBe("etc");
  });
  it("음식점이 아니면 이름으로 바꾸지 않음(카페 이름에 '베이커리'가 있어도 분류가 먼저)", () => {
    expect(mapGlyph("카페", "포비 베이커리")).toBe("cafe");
  });
  it("41가지 모두 SVG로 그릴 수 있음", () => {
    expect(Object.keys(MAP_GLYPHS)).toHaveLength(41);
    for (const key of Object.keys(MAP_GLYPHS) as (keyof typeof MAP_GLYPHS)[]) expect(mapGlyphSvg(key)).toMatch(/^<svg viewBox="0 0 24 24"[^>]*>.+<\/svg>$/);
  });
});
