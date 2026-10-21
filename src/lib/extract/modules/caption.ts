import type { ExtractorModule } from "../types";
import { CAPTION_SYSTEM } from "../prompt";
import { candidatesFromLlm } from "../normalize";

export const captionModule: ExtractorModule = {
  name: "caption",
  cost: "cheap",
  enabled: true,
  canRun: (ctx) => !!ctx.caption && ctx.caption.trim().length > 0,
  async run(ctx, { llm }) {
    const text = await llm(CAPTION_SYSTEM, [
      { type: "text", text: `캡션:\n"""\n${ctx.caption!.slice(0, 4000)}\n"""` },
    ]);
    return candidatesFromLlm(text, "caption");
  },
};
