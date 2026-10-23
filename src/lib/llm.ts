import { geminiFailure } from "./analysis-issue";
import Anthropic from "@anthropic-ai/sdk";
import { env } from "./env";

let client: Anthropic | null = null;
function anthropic(): Anthropic {
  if (!client) client = new Anthropic({ apiKey: env.anthropicKey(), timeout: 15000, maxRetries: 0 });
  return client;
}

export type LlmContent =
  | { type: "text"; text: string }
  | {
      type: "image";
      source: { type: "base64"; media_type: "image/jpeg" | "image/png" | "image/webp" | "image/gif"; data: string };
    };

/** 모듈이 LLM을 부를 때 쓰는 최소 인터페이스. 테스트에서는 가짜로 바꿔 끼웁니다. */
export type LlmCall = (system: string, content: LlmContent[]) => Promise<string>;

export const callClaude: LlmCall = async (system, content) => {
  const res = await anthropic().messages.create({
    model: env.extractModel(),
    max_tokens: 1500,
    temperature: 0,
    system,
    messages: [{ role: "user", content }],
  });
  return res.content
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("")
    .trim();
};

/** Google Gemini (AI Studio 무료 키). SDK 없이 REST로 부릅니다. */
export const callGemini: LlmCall = async (system, content) => {
  const parts = content.map((c) =>
    c.type === "text" ? { text: c.text } : { inlineData: { mimeType: c.source.media_type, data: c.source.data } },
  );
  const model = env.geminiModel();
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: "POST",
      signal: AbortSignal.timeout(15000),
      headers: { "content-type": "application/json", "x-goog-api-key": env.geminiKey() },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts }],
        generationConfig: { temperature: 0, maxOutputTokens: 4096, responseMimeType: "application/json" },
      }),
    },
  );
  if (!res.ok) {
    throw geminiFailure(res.status, await res.json().catch(() => null));
  }
  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[];
  };
  return (data.candidates?.[0]?.content?.parts ?? [])
    .filter((p) => !p.thought)
    .map((p) => p.text ?? "")
    .join("")
    .trim();
};

/** LLM_PROVIDER 값(gemini | anthropic)에 따라 고릅니다. 기본은 gemini. */
export const callLlm: LlmCall = (system, content) =>
  env.llmProvider() === "anthropic" ? callClaude(system, content) : callGemini(system, content);

/** 코드펜스나 앞뒤 군더더기가 붙어도 첫 JSON 객체를 꺼냅니다. */
export function parseJsonObject<T>(text: string): T | null {
  const cleaned = text.replace(/```(?:json)?/gi, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}
