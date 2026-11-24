import { NextResponse } from "next/server";
import { AccessError, accessError } from "@/lib/auth";
import { folderRpc, noStore, requireAccount } from "@/lib/folders-server";
import { TERMS_VERSION } from "@/lib/terms";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const account = await requireAccount(req);
    const state = await folderRpc<{ terms_version: string | null; marketing: boolean }>("dm_terms_state", { p_user: account.userId }, "약관 동의 상태를 불러오지 못했어요.");
    return NextResponse.json({ ...state, current_version: TERMS_VERSION }, noStore);
  } catch (e) { return accessError(e); }
}

/** 약관 동의(필수 3개 + 선택 1개). 버전은 서버의 현재 약관 버전으로 기록합니다. */
export async function POST(req: Request) {
  try {
    const account = await requireAccount(req);
    const b = await req.json().catch(() => null) as Record<string, unknown> | null;
    if (!(b?.service === true && b?.privacy === true && b?.location === true)) throw new AccessError("필수 약관에 모두 동의해 주세요.");
    const result = await folderRpc("dm_agree_terms", { p_user: account.userId, p_version: TERMS_VERSION, p_service: true, p_privacy: true, p_location: true, p_marketing: b.marketing === true }, "약관 동의를 저장하지 못했어요. 잠시 후 다시 시도해 주세요.");
    return NextResponse.json(result, noStore);
  } catch (e) { return accessError(e); }
}

/** 설정: 광고성 정보 수신 동의 켜기/끄기 */
export async function PATCH(req: Request) {
  try {
    const account = await requireAccount(req);
    const b = await req.json().catch(() => null) as { marketing?: unknown } | null;
    if (typeof b?.marketing !== "boolean") throw new AccessError("수신 동의 여부를 다시 골라 주세요.");
    return NextResponse.json(await folderRpc("dm_set_marketing", { p_user: account.userId, p_opt_in: b.marketing }, "수신 동의를 바꾸지 못했어요. 잠시 후 다시 시도해 주세요."), noStore);
  } catch (e) { return accessError(e); }
}
