import { afterEach, expect, it, vi } from "vitest";
vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn(() => ({})) }));
import { createClient } from "@supabase/supabase-js";
import { db } from "@/lib/db";
afterEach(() => vi.unstubAllGlobals());
it("인증·지도 조회는 Next fetch 캐시를 우회하고 기존 요청 헤더를 유지", async () => {
  vi.stubEnv("SUPABASE_URL", "https://db.test");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-key");
  const fetcher = vi.fn(async () => Response.json([]));
  vi.stubGlobal("fetch", fetcher);
  db();
  const options = vi.mocked(createClient).mock.calls[0][2];
  await options!.global!.fetch!("https://db.test/rest/v1/places", { cache: "force-cache", headers: { Authorization: "test" } });
  expect(fetcher).toHaveBeenCalledWith("https://db.test/rest/v1/places", expect.objectContaining({ cache: "no-store", headers: { Authorization: "test" } }));
});
