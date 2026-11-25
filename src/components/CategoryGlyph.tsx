import Icon from "./Icon";
import { MAP_GLYPHS, glyphTone, mapGlyph, type GlyphTone } from "@/lib/map-glyphs";

/** 분류 아이콘의 바탕색 묶음(.category-cup 등). 지도 핀과 같은 규칙(mapGlyph)으로 고릅니다. */
export function categoryTone(category: string | null | undefined, name = ""): GlyphTone {
  return glyphTone(mapGlyph(category, name));
}

/**
 * 리스트·검색·시트의 분류 아이콘. 지도 핀 안의 아이콘(map-glyphs.ts, 41가지)과 같은 그림을 써서
 * 같은 장소가 지도와 리스트에서 다른 아이콘으로 보이지 않게 합니다(찜질방 = ♨). 분류를 모르면 위치 핀.
 */
export default function CategoryGlyph({ category, name = "", size = 22 }: { category: string | null | undefined; name?: string; size?: number }) {
  const glyph = mapGlyph(category, name);
  if (glyph === "etc") return <Icon name="pin" width={size} />;
  // MAP_GLYPHS는 코드에 적힌 고정 SVG 조각이라 그대로 넣어도 안전합니다(사용자 입력 아님).
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false" dangerouslySetInnerHTML={{ __html: MAP_GLYPHS[glyph] }} />;
}
