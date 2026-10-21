import type { ExtractorModule } from "../types";
import type { LlmContent } from "../../llm";
import { IMAGE_SYSTEM } from "../prompt";
import { candidatesFromLlm } from "../normalize";

const MAX_IMAGES = 4;

/** 사용자가 함께 보낸 스크린샷에서 간판·메뉴·자막을 읽습니다. */
export const imageModule: ExtractorModule = {
  name: "image",
  cost: "heavy",
  enabled: true,
  canRun: (ctx) => ctx.images.length > 0,
  async run(ctx, { llm }) {
    const content: LlmContent[] = ctx.images.slice(0, MAX_IMAGES).map((img) => ({
      type: "image",
      source: { type: "base64", media_type: img.mediaType, data: img.data },
    }));
    const hint = ctx.caption ? `참고용 캡션(장소 정보 없음으로 판단됨):\n${ctx.caption.slice(0, 500)}` : "캡션 없음";
    content.push({ type: "text", text: `${hint}\n\n위 이미지에서 장소를 뽑아 주세요.` });
    const text = await llm(IMAGE_SYSTEM, content);
    return candidatesFromLlm(text, "image");
  },
};
