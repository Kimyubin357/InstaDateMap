import { redirect } from "next/navigation";
import { safeNext } from "@/lib/auth";
export const dynamic = "force-dynamic";
/** 예전 PIN 입장 주소. 입장은 카카오·구글 로그인으로만 합니다. */
export default async function EnterPage({ searchParams: query }: { searchParams: Promise<{ next?: string }> }) {
  const searchParams = await query;
  redirect(`/login?next=${encodeURIComponent(safeNext(searchParams.next))}`);
}
