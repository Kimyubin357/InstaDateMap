import { redirect } from "next/navigation";
import { accountFromRequest, safeNext } from "@/lib/auth";
import { pageRequest } from "@/lib/access";
import { loginError } from "@/lib/oauth";
import LoginScreen from "./LoginScreen";
export const dynamic = "force-dynamic";
export default async function LoginPage({ searchParams: query }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const searchParams = await query;
  const next = safeNext(searchParams.next);
  // 계정 세션은 바로 지도로. 기존 PIN 세션은 계정으로 옮겨 가도록 로그인 화면을 보여줍니다.
  if (await accountFromRequest(await pageRequest())) redirect(next);
  return <LoginScreen next={next} error={loginError(searchParams.error)} />;
}
