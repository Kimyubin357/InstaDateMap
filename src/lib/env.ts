function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable ${name}`);
  return v;
}

export const env = {
  supabaseUrl: () => need("SUPABASE_URL"),
  supabaseServiceKey: () => need("SUPABASE_SERVICE_ROLE_KEY"),
  llmProvider: () => (process.env.LLM_PROVIDER || "gemini").toLowerCase(),
  geminiKey: () => need("GEMINI_API_KEY"),
  geminiModel: () => process.env.GEMINI_MODEL || "gemini-flash-lite-latest",
  anthropicKey: () => need("ANTHROPIC_API_KEY"),
  extractModel: () => process.env.EXTRACT_MODEL || "claude-haiku-5-5",
  kakaoRestKey: () => need("KAKAO_REST_API_KEY"),
  oembedToken: () => process.env.INSTAGRAM_OEMBED_TOKEN || "",
  oembedVersion: () => process.env.INSTAGRAM_OEMBED_VERSION || "v21.0",
  baseUrl: () => (process.env.APP_BASE_URL || "").replace(/\/$/, ""),
};
