import { AccessError, boardFromRequest, requireIdentity, unauthorized, accessError } from "@/lib/auth";
import { db } from "@/lib/db";
import { withSavedPlace } from "@/lib/saved-place-server";
export const runtime = "nodejs";
async function change(req: Request, route: { params: Promise<{ id: string }> }, action: "restore" | "purge") {
  try {
    const board = await boardFromRequest(req);
    if (!board) return unauthorized();
    requireIdentity(board);
    const { id } = await route.params;
    const body = await req.json().catch(() => null);
    if (typeof body?.deleted_at !== "string" || !Number.isFinite(Date.parse(body.deleted_at))) throw new AccessError("삭제한 장소 목록을 새로 불러와 주세요.");
    const { data, error } = await db().rpc("dm_trash_place", { p_board: board.id, p_id: id, p_who: board.who, p_action: action, p_expected: body.deleted_at });
    if (error) throw new Error(action === "restore" ? "복구 결과를 확인하지 못했어요. 목록을 새로 불러와 확인해 주세요." : "영구 삭제 결과를 확인하지 못했어요. 목록을 새로 불러와 확인해 주세요.");
    if (data?.code) return Response.json({ code: data.code, message: data.code === "PLACE_NOT_FOUND" ? "이미 영구 삭제된 장소예요." : "장소의 상태가 바뀌었어요. 목록을 새로 불러와 주세요." }, { status: data.code === "PLACE_NOT_FOUND" ? 404 : 409, headers: { "Cache-Control": "no-store" } });
    if (!data?.ok) throw new Error("처리 결과를 확인하지 못했어요.");
    const result = action === "restore" ? await withSavedPlace(board, { ...data, place_url: `/?place=${encodeURIComponent(id)}` }) : data;
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return accessError(error); }
}
export const POST = (req: Request, route: { params: Promise<{ id: string }> }) => change(req, route, "restore");
export const DELETE = (req: Request, route: { params: Promise<{ id: string }> }) => change(req, route, "purge");
