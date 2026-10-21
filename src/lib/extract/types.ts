import type { MediaType } from "../types";
import type { LlmCall } from "../llm";

export type ModuleName = "caption" | "location_tag" | "image" | "video";

/** 모든 추출 모듈이 받는 같은 입력 */
export interface SourceContext {
  url: string;
  mediaType: MediaType;
  caption: string | null;
  locationTag: string | null;
  /** 사용자가 단축어로 함께 보낸 스크린샷 (base64) */
  images: { mediaType: "image/jpeg" | "image/png" | "image/webp"; data: string }[];
  /** 사용자가 단축어로 함께 보낸 화면 녹화 (base64, 2단계) */
  videos: { mediaType: string; data: string }[];
}

/** 모든 추출 모듈이 내는 같은 출력 */
export interface PlaceCandidate {
  name: string;
  branch: string | null;
  address: string | null;
  areaHint: string | null;
  category: string | null;
  confidence: number; // 0~1
  evidence: string;   // 어디서 봤는지 (캡션 문장, 간판 등)
  module: ModuleName;
}

export interface ModuleDeps {
  llm: LlmCall;
}

/** 새 모듈은 이 규격만 맞추면 라우터에 등록할 수 있습니다. */
export interface ExtractorModule {
  name: ModuleName;
  /** cheap = 항상 실행, heavy = 앞 모듈 결과가 부족할 때만 */
  cost: "cheap" | "heavy";
  /** 이 모듈을 켤지 여부 (예: 영상 모듈은 2단계에서 켬) */
  enabled: boolean;
  canRun(ctx: SourceContext): boolean;
  run(ctx: SourceContext, deps: ModuleDeps): Promise<PlaceCandidate[]>;
}
