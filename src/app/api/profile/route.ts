import { NextResponse } from "next/server";
import { AccessError, accessError } from "@/lib/auth";
import { folderRpc, noStore, requireAccount } from "@/lib/folders-server";
import { profileInput, type Profile } from "@/lib/profile";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const account = await requireAccount(req);
    return NextResponse.json(await folderRpc<Profile>("dm_get_profile", { p_user: account.userId }, "프로필을 불러오지 못했어요. 잠시 후 다시 시도해 주세요."), noStore);
  } catch (e) { return accessError(e); }
}

/** 이름·사진 저장. 이름이 바뀌면 참여한 모든 폴더의 기록도 새 이름으로 바뀝니다. */
export async function PATCH(req: Request) {
  try {
    const account = await requireAccount(req);
    const input = profileInput(await req.json().catch(() => null));
    if (typeof input === "string") throw new AccessError(input);
    const profile = await folderRpc<Profile>("dm_set_profile", { p_user: account.userId, p_name: input.name, p_avatar_mode: input.mode, p_avatar: input.avatar }, "프로필을 저장하지 못했어요. 잠시 후 다시 시도해 주세요.");
    return NextResponse.json(profile, noStore);
  } catch (e) { return accessError(e); }
}
