import { AccessError, accessError, boardFromRequest, dbUserError, requireIdentity, accountFromRequest, unauthorized } from "@/lib/auth";
import { db } from "@/lib/db";
import { isUuid } from "@/lib/folders";
import { withSavedPlace } from "@/lib/saved-place-server";
export const runtime = "nodejs";
const noStore = { headers: { "Cache-Control": "no-store" } };

/** 복구: 지웠던 방으로 돌아갑니다. 같은 가게가 다시 등록돼 있으면 그 장소를 두고 메모만 합칩니다. */
export async function POST(req: Request, route: { params: Promise<{ id: string }> }) {
  try {
    const account = await accountFromRequest(req);
    if (!account) return unauthorized();
    const { id } = await route.params;
    if (!isUuid(id)) throw new AccessError("삭제한 장소 목록을 새로 불러와 주세요.", 404);
    const { data, error } = await db().rpc("dm_restore_place", { p_user: account.userId, p_log: id });
    const userError = dbUserError(error);
    if (userError) throw userError;
    if (error) throw new Error("복구 결과를 확인하지 못했어요. 목록을 새로 불러와 확인해 주세요.");
    if (data?.code === "LOG_NOT_FOUND") return Response.json({ code: data.code, message: "이미 복구했거나 기록에서 지운 장소예요." }, { status: 404, ...noStore });
    if (!data?.ok) throw new Error("복구 결과를 확인하지 못했어요. 목록을 새로 불러와 확인해 주세요.");
    const result = { ok: true, board_id: data.board_id as string, board_name: data.board_name as string, merged: !!data.merged, place_url: `/?place=${encodeURIComponent(data.place_id)}` };
    // 지금 연 방으로 복구했으면 지도에 바로 보이도록 장소 정보를 함께 돌려줍니다.
    const board = data.board_id === account.boardId ? await boardFromRequest(req) : null;
    if (board) { requireIdentity(board); return Response.json(await withSavedPlace(board, result), noStore); }
    return Response.json(result, noStore);
  } catch (error) { return accessError(error); }
}

/** 기록에서 지우기(되돌릴 수 없음) */
export async function DELETE(req: Request, route: { params: Promise<{ id: string }> }) {
  try {
    const account = await accountFromRequest(req);
    if (!account) return unauthorized();
    const { id } = await route.params;
    if (!isUuid(id)) throw new AccessError("삭제한 장소 목록을 새로 불러와 주세요.", 404);
    const { error } = await db().rpc("dm_purge_trash_log", { p_user: account.userId, p_log: id });
    if (error) throw new Error("기록을 지우지 못했어요. 목록을 새로 불러와 확인해 주세요.");
    return Response.json({ ok: true }, noStore);
  } catch (error) { return accessError(error); }
}
