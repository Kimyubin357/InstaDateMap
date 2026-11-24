import { redirect } from "next/navigation";
import { accountFromRequest, safeNext } from "@/lib/auth";
import { pageRequest } from "@/lib/access";
import { folderRpc } from "@/lib/folders-server";
import type { Profile } from "@/lib/profile";
import WelcomeScreen from "./WelcomeScreen";
export const dynamic = "force-dynamic";
/** 처음 가입하면 이름(과 사진)을 먼저 정합니다. 이미 정했으면 바로 다음 화면으로. */
export default async function WelcomePage({ searchParams: query }: { searchParams: Promise<{ next?: string }> }) {
  const { next: raw } = await query;
  const next = raw === "/folders" ? "/folders" : safeNext(raw);
  const account = await accountFromRequest(await pageRequest());
  if (!account) redirect(`/login?next=${encodeURIComponent(next)}`);
  const profile = await folderRpc<Profile>("dm_get_profile", { p_user: account.userId }, "프로필을 불러오지 못했어요.");
  if (profile.name_confirmed) redirect(next);
  return <WelcomeScreen profile={profile} next={next} />;
}
