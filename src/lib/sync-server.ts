import { db } from "./db";
import type { Board } from "./auth";
import type { SyncAccess } from "./sync-types";
export function syncAccess(board: Board): SyncAccess {
  return { boardId: board.id, authVersion: board.authVersion, who: board.who, memberNames: board.memberNames, expiresAt: board.expiresAt, kakaoKey: process.env.NEXT_PUBLIC_KAKAO_JS_KEY || "" };
}
export async function boardRevision(boardId: string): Promise<string> {
  const { data, error } = await db().rpc("dm_board_revision", { p_board: boardId });
  if (error || typeof data !== "string" || !/^\d+$/.test(data)) throw new Error("변경 내용을 확인하지 못했어요. 데이터베이스 업데이트와 연결을 확인해 주세요.");
  return data;
}
