import { afterEach, expect, it, vi } from "vitest";
import { geminiFailure } from "@/lib/analysis-issue";
import { callLlm } from "@/lib/llm";
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
it.each([
  [429, "GenerateRequestsPerDayPerProjectPerModel-FreeTier", "gemini_free_daily_quota"],
  [429, "GenerateRequestsPerDayPerProjectPerModel", "gemini_daily_quota"],
  [429, "GenerateRequestsPerMinutePerProjectPerModel-FreeTier", "gemini_rate_limit"],
  [429, "generate_content_free_tier_requests", "gemini_free_quota"],
  [429, "RESOURCE_EXHAUSTED", "gemini_quota"],
  [403, "API key secret internal detail", "gemini_auth"],
  [503, "Unavailable", "gemini_unavailable"],
])("HTTP %s / %s identifies only supported evidence", (status, quotaId, code) => {
  const error = geminiFailure(status as number, { error: { details: [{ violations: [{ quotaId }] }] } });
  expect(error.code).toBe(code); expect(error.message).not.toContain(quotaId as string);
});
it("malformed quota error cannot be reported as an exhausted free daily quota", () => {
  expect(geminiFailure(429, null).code).toBe("gemini_quota");
});
it("Gemini HTTP rejection is translated without exposing the raw error", async () => {
  vi.stubEnv("LLM_PROVIDER", "gemini"); vi.stubEnv("GEMINI_API_KEY", "test-key");
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { message: "sensitive-project", details: [{ quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier" }] } }), { status: 429 })));
  await expect(callLlm("system", [{ type: "text", text: "caption" }])).rejects.toMatchObject({ code: "gemini_free_daily_quota" });
});
