import { db } from "./db";
import { TERMS_VERSION } from "./terms";

/** 이 계정이 지금 약관 버전에 동의했는지. 조회 오류는 막지 않고(서비스 계속) 로그만 남깁니다. */
export async function termsPending(userId: string): Promise<boolean> {
  const { data, error } = await db().from("app_users").select("terms_version").eq("id", userId).maybeSingle();
  if (error) { console.error("termsPending: read failed", error.code, error.message); return false; }
  return !!data && data.terms_version !== TERMS_VERSION;
}
export const consentPath = (next: string) => `/consent?next=${encodeURIComponent(next)}`;
