import { AccessError, accessError, boardFromRequest, requireIdentity, unauthorized } from "@/lib/auth";
import { db } from "@/lib/db";
import { isUuid, validCollectionCommand } from "@/lib/collections";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
const errors: Record<string, [number, string]> = {
  COLLECTION_NOT_FOUND: [404, "이 모음이 삭제되었어요. 목록에서 다시 골라 주세요."],
  COLLECTION_CONFLICT: [409, "다른 기기에서 모음이 바뀌었어요. 최신 내용을 불러온 뒤 다시 수정해 주세요."],
  COLLECTION_NAME_EXISTS: [409, "같은 이름의 모음이 있어요. 다른 이름을 지어 주세요."],
  COLLECTION_PLACE_CHANGED: [409, "선택한 장소 중 삭제된 곳이 있어요. 목록에서 다시 골라 주세요."],
  COLLECTION_LIMIT: [409, "모음은 100개까지 만들 수 있어요. 쓰지 않는 모음을 정리해 주세요."],
  OPERATION_MISMATCH: [409, "처리 중인 요청과 내용이 달라요. 목록을 확인한 뒤 다시 시도해 주세요."],
  UNDO_UNAVAILABLE: [409, "모음이나 장소가 바뀌어 되돌릴 수 없어요. 현재 목록을 확인해 주세요."],
};
export async function GET(req: Request) {
  try {
    const board = await boardFromRequest(req); if (!board) return unauthorized();
    const operation = new URL(req.url).searchParams.get("operation");
    if (!isUuid(operation)) throw new AccessError("처리 기록을 다시 확인해 주세요.");
    const { data, error } = await db().from("collection_operations").select("result").eq("board_id", board.id).eq("id", operation).maybeSingle();
    if (error) { console.error("collection receipt", error); throw new Error("처리 여부를 확인하지 못했어요. 다시 확인해 주세요."); }
    return Response.json({ result: data?.result ?? null }, { headers });
  } catch (e) { return accessError(e); }
}
export async function POST(req: Request) {
  try {
    const board = await boardFromRequest(req); if (!board) return unauthorized(); requireIdentity(board);
    const body = await req.json().catch(() => null);
    if (!isUuid(body?.operation_id) || !validCollectionCommand(body?.command)) throw new AccessError("모음 이름과 선택한 장소를 확인해 주세요.");
    const { data, error } = await db().rpc("dm_change_collection", { p_board: board.id, p_who: board.who, p_operation: body.operation_id, p_command: body.command });
    if (error) { console.error("collection write", error); return Response.json({ status: "error", code: "COLLECTION_UNCONFIRMED", message: "처리 여부를 다시 확인하고 있어요." }, { status: 503, headers }); }
    if (data?.code) { const [status, message] = errors[data.code] ?? [400, "모음 내용을 확인하고 다시 시도해 주세요."]; return Response.json({ status: "error", code: data.code, message }, { status, headers }); }
    if (!data?.ok) throw new Error("모음 처리 결과를 확인하지 못했어요.");
    return Response.json(data, { headers });
  } catch (e) { return accessError(e); }
}
