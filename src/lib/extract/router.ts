import type { ExtractorModule, ModuleDeps, PlaceCandidate, SourceContext } from "./types";
import { captionModule } from "./modules/caption";
import { locationTagModule } from "./modules/locationTag";
import { imageModule } from "./modules/image";
import { videoModule } from "./modules/video";
import { mergeCandidates } from "./merge";

/** 등록된 모듈. 새 모듈은 여기에 한 줄 추가하면 됩니다. */
export const MODULES: ExtractorModule[] = [locationTagModule, captionModule, imageModule, videoModule];

/** 이 신뢰도 이상인 후보가 하나라도 있으면 무거운 모듈을 건너뜁니다. */
export const GOOD_ENOUGH = 0.6;

export interface ExtractResult {
  candidates: PlaceCandidate[];
  ran: string[];
  errors: { module: string; message: string }[];
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
      errors.push({ module: m.name, message: e instanceof Error ? e.message : String(e) });
    }
  };

  const usable = modules.filter((m) => m.enabled && m.canRun(ctx));
  // 1) 가벼운 모듈은 함께 실행
  await Promise.all(usable.filter((m) => m.cost === "cheap").map(runOne));

  // 2) 결과가 부족할 때만 무거운 모듈을 하나씩 실행
  for (const m of usable.filter((x) => x.cost === "heavy")) {
    if (collected.some((c) => c.confidence >= GOOD_ENOUGH)) break;
    await runOne(m);
  }

  return { candidates: mergeCandidates(collected), ran, errors };
}
