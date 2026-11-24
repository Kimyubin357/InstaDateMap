import { redirect } from "next/navigation";
import { accountFromRequest, safeNext } from "@/lib/auth";
import { pageRequest } from "@/lib/access";
import { loginError } from "@/lib/oauth";
import LoginScreen from "./LoginScreen";
export const dynamic = "force-dynamic";
export default async function LoginPage({ searchParams: query }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const searchParams = await query;
  const next = safeNext(searchParams.next);
  // 이미 로그인한 기기는 바로 지도로.
  if (await accountFromRequest(await pageRequest())) redirect(next);
  return <LoginScreen next={next} error={loginError(searchParams.error)} />;
}
