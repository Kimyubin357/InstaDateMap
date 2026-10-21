import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { env } from "./env";

let client: SupabaseClient | null = null;

/** 서버 전용 클라이언트. service role 키를 쓰므로 브라우저로 절대 보내지 않습니다. */
export function db(): SupabaseClient {
  if (!client) {
    client = createClient(env.supabaseUrl(), env.supabaseServiceKey(), {
      auth: { persistSession: false },
    });
  }
  return client;
}
