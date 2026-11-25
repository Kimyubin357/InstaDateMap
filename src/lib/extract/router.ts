import { AnalysisError, type AnalysisIssue } from "../analysis-issue";
import type { ExtractorModule, ModuleDeps, PlaceCandidate, SourceContext } from "./types";
import { captionModule } from "./modules/caption";
import { imageModule } from "./modules/image";
import { videoModule } from "./modules/video";
import { mergeCandidates } from "./merge";

/**
 * 등록된 모듈. 새 모듈은 여기에 한 줄 추가하면 됩니다.
 * 장소 이름은 캡션에서만 읽습니다(사용자 결정 2026-11-25). 위치 태그(역·동네 등)는 식당의 보조 위치일 때가 많아
 * 장소 후보로 쓰지 않으므로 locationTag 모듈은 등록하지 않습니다(코드는 modules/locationTag.ts에 남김).
 */
export const MODULES: ExtractorModule[] = [captionModule, imageModule, videoModule];

/** 이 신뢰도 이상인 후보가 하나라도 있으면 무거운 모듈을 건너뜁니다. */
export const GOOD_ENOUGH = 0.6;

export interface ExtractResult {
  candidates: PlaceCandidate[];
  ran: string[];
  errors: { module: string; message: string; code?: AnalysisIssue }[];
}

export async function extractPlaces(
  ctx: SourceContext,
  deps: ModuleDeps,
  modules: ExtractorModule[] = MODULES,
): Promise<ExtractResult> {
  const ran: string[] = [];
  const errors: ExtractResult["errors"] = [];
  const collected: PlaceCandidate[] = [];

  const runOne = async (m: ExtractorModule) => {
    ran.push(m.name);
    try {
      collected.push(...(await m.run(ctx, deps)));
    } catch (e) {
      errors.push({ module: m.name, message: e instanceof Error ? e.message : String(e), ...(e instanceof AnalysisError ? { code: e.code } : {}) });
    }
  };

  const usable = modules.filter((m) => m.enabled && m.canRun(ctx));
  // 1) 가벼운 모듈은 함께 실행
  await Promise.all(usable.filter((m) => m.cost === "cheap").map(runOne));

  // 2) 결과가 부족할 때만 무거운 모듈을 하나씩 실행
  for (const m of usable.filter((x) => x.cost === "heavy")) {
    if (errors.some((error) => error.code)) break;
    // 사용자가 올린 스크린샷은 명시적인 재시도이므로 반드시 읽습니다.
    if (collected.some((c) => c.confidence >= GOOD_ENOUGH) && !(m.name === "image" && ctx.images.length > 0)) continue;
    await runOne(m);
  }

  return { candidates: mergeCandidates(collected), ran, errors };
}
