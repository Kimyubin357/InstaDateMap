import type { ExtractorModule } from "../types";

const REGIONS = new Set([
  "대한민국", "한국", "서울", "부산", "대구", "인천", "광주", "대전", "울산", "세종", "경기", "경기도",
  "강원", "강원도", "충북", "충청북도", "충남", "충청남도", "전북", "전라북도", "전남", "전라남도",
  "경북", "경상북도", "경남", "경상남도", "제주", "제주도", "수원", "용인", "성남", "안양", "고양", "화성",
]);

/** 광역 지역 태그는 방문할 가게가 아닙니다. 서울숲 같은 실제 장소는 유지합니다. */
export function isRegionTag(raw: string): boolean {
  const parts = raw.trim().split(/[\s,]+/);
  return parts.length > 0 && parts.every((p) => REGIONS.has(p) || /(?:특별시|광역시|특별자치시|특별자치도|시|군|구|동|읍|면)$/.test(p));
}

/** 게시물에 위치 태그가 있으면 LLM 없이 그대로 후보로 씁니다. */
export const locationTagModule: ExtractorModule = {
  name: "location_tag",
  cost: "cheap",
  enabled: true,
  canRun: (ctx) => !!ctx.locationTag,
  async run(ctx) {
    const raw = ctx.locationTag!.trim();
    if (!raw || isRegionTag(raw)) return [];
    // "카페 OO 성수점" → name "카페 OO", branch "성수점"
    const m = raw.match(/^(.*\S)\s+(\S+점)$/);
    return [
      {
        name: m ? m[1] : raw,
        branch: m ? m[2] : null,
        address: null,
        areaHint: null,
        category: null,
        confidence: 0.85,
        evidence: `위치 태그: ${raw}`,
        module: "location_tag",
      },
    ];
  },
};
