import { requirePageBoard } from "@/lib/access";
import { safeNext } from "@/lib/auth";
import ChooseForm from "./ChooseForm";
export const dynamic = "force-dynamic";
export default async function ChoosePage({ searchParams }: { searchParams: { next?: string } }) {
  const board = await requirePageBoard(safeNext(searchParams.next), false);
  return <ChooseForm names={board.memberNames} next={safeNext(searchParams.next)} />;
}
