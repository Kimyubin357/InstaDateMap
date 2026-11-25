import { accessError } from "@/lib/auth";
import { db } from "@/lib/db";
import { noStore, requireAccount } from "@/lib/folders-server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 처음 사용법(온보딩)을 본 기록(021_onboarding.sql). 계정마다 한 번이라 다른 기기에서 다시 뜨지 않습니다.
 * 021이 아직 적용되지 않은 DB나 조회 오류에서는 "모름"(onboarded: null)으로 답하고, 화면은 이 기기의 기록으로 판단합니다.
 * 원인은 서버 로그에만 남깁니다.
 */
export async function GET(req: Request) {
  try {
    const account = await requireAccount(req);
    const { data, error } = await db().rpc("dm_onboarding_state", { p_user: account.userId });
    if (error) { console.error("dm_onboarding_state failed", error.code, error.message); return Response.json({ onboarded: null }, noStore); }
    const state = data as { onboarded_at?: unknown } | null;
    if (!state || typeof state !== "object") return Response.json({ onboarded: null }, noStore);
    return Response.json({ onboarded: typeof state.onboarded_at === "string" && state.onboarded_at.length > 0 }, noStore);
  } catch (e) { return accessError(e); }
}

/** 끝까지 보거나 건너뛰면 적습니다. 처음 본 시각을 지키고, 저장하지 못해도 화면을 막지 않습니다(stored: false). */
export async function POST(req: Request) {
  try {
    const account = await requireAccount(req);
    const { data, error } = await db().rpc("dm_mark_onboarded", { p_user: account.userId });
    if (error) { console.error("dm_mark_onboarded failed", error.code, error.message); return Response.json({ ok: true, stored: false }, noStore); }
    return Response.json({ ok: true, stored: !!data }, noStore);
  } catch (e) { return accessError(e); }
}
