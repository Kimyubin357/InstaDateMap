import { redirect } from "next/navigation";
import { pageRequest, setupSession } from "@/lib/access";
import { safeNext } from "@/lib/auth";
import { db } from "@/lib/db";
import SetupForm from "./SetupForm";
import { suggestedMemberNames } from "@/lib/member-names";
export const dynamic = "force-dynamic";
export default async function SetupPage({ searchParams: query }: { searchParams: Promise<{ next?: string }> }) {
  const searchParams = await query;
  let session;
  try { session = await setupSession(await pageRequest()); } catch { redirect("/enter"); }
  const { data: board } = await db().from("boards").select("pin_hash, auth_version").eq("id", session.board_id).single();
  if (!board || board.pin_hash || board.auth_version !== session.auth_version) redirect("/enter");
  const [sources, saves] = await Promise.all([
    db().from("sources").select("shared_by").eq("board_id", session.board_id),
    db().from("place_saves").select("added_by").eq("board_id", session.board_id),
  ]);
  if (sources.error || saves.error) throw new Error("기존 저장자 이름을 확인하지 못했어요. 잠시 후 다시 열어 주세요.");
  const names = suggestedMemberNames([...(sources.data ?? []).map((s) => s.shared_by), ...(saves.data ?? []).map((s) => s.added_by)]);
  return <SetupForm names={names} next={safeNext(searchParams.next)} />;
}
