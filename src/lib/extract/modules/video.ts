import type { ExtractorModule } from "../types";

/**
 * 영상 모듈 (2단계). 규격만 먼저 맞춰 둔 자리입니다.
 * 구현 계획: 화면 녹화에서 키프레임 추출(ffmpeg) → 프레임은 이미지 모듈 방식으로 OCR,
 * 음성은 STT로 받아 캡션 모듈 프롬프트에 넣기 → 결과 병합.
 * enabled를 true로 바꾸고 run을 채우면 라우터가 자동으로 부릅니다.
 */
export const videoModule: ExtractorModule = {
  name: "video",
  cost: "heavy",
  enabled: false,
  canRun: (ctx) => ctx.mediaType === "reel" && ctx.videos.length > 0,
  async run() {
    return [];
  },
};
