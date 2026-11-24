import { redirect } from "next/navigation";
import { accountFromRequest, safeNext } from "@/lib/auth";
import { pageRequest } from "@/lib/access";
import { termsPending } from "@/lib/terms-server";
import ConsentScreen from "./ConsentScreen";
export const dynamic = "force-dynamic";
/** 로그인 직후(처음 또는 약관이 바뀐 뒤) 한 번 약관 동의를 받습니다. */
export default async function ConsentPage({ searchParams: query }: { searchParams: Promise<{ next?: string }> }) {
  const { next: raw } = await query;
  const next = raw === "/folders" ? "/folders" : safeNext(raw);
  const account = await accountFromRequest(await pageRequest());
  if (!account) redirect(`/login?next=${encodeURIComponent(next)}`);
  if (!await termsPending(account.userId)) redirect(next);
  return <ConsentScreen next={next} />;
}
