import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { env } from "./env";

let client: SupabaseClient | null = null;

/** 서버 전용 클라이언트. service role 키를 쓰므로 브라우저로 절대 보내지 않습니다. */
export function db(): SupabaseClient {
  if (!client) {
    client = createClient(env.supabaseUrl(), env.supabaseServiceKey(), {
      auth: { persistSession: false },
      // Next의 fetch 캐시에 인증 결과나 변경 전 지도 목록이 남지 않도록 합니다.
      global: { fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }) },
    });
  }
  return client;
}
