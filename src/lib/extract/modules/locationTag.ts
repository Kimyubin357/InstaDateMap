import type { ExtractorModule } from "../types";

/** 게시물에 위치 태그가 있으면 LLM 없이 그대로 후보로 씁니다. */
export const locationTagModule: ExtractorModule = {
  name: "location_tag",
  cost: "cheap",
  enabled: true,
  canRun: (ctx) => !!ctx.locationTag,
  async run(ctx) {
    const raw = ctx.locationTag!.trim();
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
