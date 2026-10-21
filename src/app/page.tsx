import MapApp from "./MapApp";
import { legacyRedirect, requirePageBoard } from "@/lib/access";
export const dynamic = "force-dynamic";
export default async function Page({ searchParams }: { searchParams: { t?: string; place?: string } }) {
  const next = searchParams.place ? `/?place=${encodeURIComponent(searchParams.place)}` : "/";
  legacyRedirect(searchParams.t, next);
  const board = await requirePageBoard(next);
  return <MapApp who={board.who} kakaoKey={process.env.NEXT_PUBLIC_KAKAO_JS_KEY ?? ""} />;
}
