import { AccessError, dbUserError, type Board } from "./auth";
import { db } from "./db";

export const SOURCE_MESSAGES: Record<string, string> = {
  SOURCE_BUSY: "이미 이 링크로 작업 중이에요. 먼저 시작한 사람이 등록을 마친 뒤 다시 시도해 주세요.",
  SOURCE_STALE: "장소 후보가 갱신됐어요. 확인 화면을 새로 열어 주세요.",
  SOURCE_NOT_FOUND: "링크를 찾을 수 없어요.",
};
export function workOwner(board: Board, workId: unknown) {
  if (typeof workId !== "string" || !/^[a-f0-9-]{36}$/i.test(workId)) throw new AccessError("확인 화면을 새로 열어 주세요.");
  return `${board.sessionHash}:${workId}`;
}
export function checkWork(error: { message: string; code?: string } | null, data?: { code?: string }) {
  const code = data?.code || Object.keys(SOURCE_MESSAGES).find((key) => error?.message.includes(key));
  if (code) throw new AccessError(SOURCE_MESSAGES[code] || "링크 상태를 다시 확인해 주세요.", code === "SOURCE_NOT_FOUND" ? 404 : 409);
  const userError = dbUserError(error);
  if (userError) throw userError;
  if (error) { console.error("source work failed", error.code, error.message); throw new Error("링크 상태를 확인하지 못했어요. 잠시 후 다시 시도해 주세요."); }
}
export async function recoverSources(boardId: string) {
  const { error } = await db().rpc("dm_recover_sources", { p_board: boardId });
  checkWork(error);
}
