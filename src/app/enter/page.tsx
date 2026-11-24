import { redirect } from "next/navigation";
import { boardFromRequest, safeNext } from "@/lib/auth";
import { pageRequest } from "@/lib/access";
export const dynamic = "force-dynamic";
/** 예전 PIN 입장 주소. 이제 입장은 카카오·구글 로그인으로 합니다. 이미 열린 PIN 세션은 그대로 유지합니다. */
export default async function EnterPage({ searchParams: query }: { searchParams: Promise<{ next?: string }> }) {
  const searchParams = await query;
  const next = safeNext(searchParams.next);
  const session = await boardFromRequest(await pageRequest());
  if (session) redirect(session.who ? next : `/choose?next=${encodeURIComponent(next)}`);
  redirect(`/login?next=${encodeURIComponent(next)}`);
}
