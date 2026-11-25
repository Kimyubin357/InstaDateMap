import { NextResponse } from "next/server";
import { accessError } from "@/lib/auth";
import { noStore, requireAccount } from "@/lib/folders-server";
import { roomSummaries } from "@/lib/rooms-server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 방 버튼·내 방 시트·리스트 [방] 칸: 내 방(색·장소 수·모음 수·멤버)과 이 기기가 연 방(전체에서 + 로 저장할 방) */
export async function GET(req: Request) {
  try {
    const account = await requireAccount(req);
    const { rooms } = await roomSummaries(account.userId);
    return NextResponse.json({ current: account.boardId, rooms }, noStore);
  } catch (e) { return accessError(e); }
}
