import { redirect } from "next/navigation";
import { boardFromRequest, safeNext } from "@/lib/auth";
import { defaultBoard, pageRequest } from "@/lib/access";
import EnterForm from "./EnterForm";
export const dynamic = "force-dynamic";
export default async function EnterPage({ searchParams: query }: { searchParams: Promise<{ next?: string }> }) {
  const searchParams = await query;
  const next = safeNext(searchParams.next);
  const session = await boardFromRequest(await pageRequest());
  if (session) redirect(session.who ? next : `/choose?next=${encodeURIComponent(next)}`);
  const board = await defaultBoard();
  return <EnterForm configured={!!board.pin_hash} next={next} />;
}
