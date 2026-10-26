import { boardFromRequest, unauthorized, requireIdentity, accessError } from "@/lib/auth";
import { schedulePlacePushes } from "@/lib/push-server";
import { db } from "@/lib/db";

export const runtime = "nodejs";

const STATUSES = new Set(["wish", "visited", "again", "meh"]);

export async function GET(req: Request, { params: route }: { params: Promise<{ id: string }> }) {
  try {
    const params = await route;
    const board = await boardFromRequest(req);
    if (!board) {
      const response = unauthorized();
      response.headers.set("Cache-Control", "no-store");
      return response;
    }
    requireIdentity(board);
    const { data, error } = await db().from("places").select("id, status, memo, memo_version, memo_updated_by").is("deleted_at", null).eq("id", params.id).eq("board_id", board.id).maybeSingle();
    if (error) return Response.json({ message: "장소의 최신 내용을 확인하지 못했어요. 다시 시도해 주세요." }, { status: 500, headers: { "Cache-Control": "no-store" } });
    if (!data) return Response.json({ code: "PLACE_NOT_FOUND", message: "이미 삭제된 장소예요." }, { status: 404, headers: { "Cache-Control": "no-store" } });
    return Response.json({ place: { id: data.id, status: data.status, memo: data.memo, memo_version: data.memo_version, memo_updated_by: data.memo_updated_by } }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return accessError(e);
  }
}

export async function PATCH(req: Request, { params: route }: { params: Promise<{ id: string }> }) {
  try {
    const params = await route;
    const board = await boardFromRequest(req);
    if (!board) return unauthorized();
    requireIdentity(board);
    const body = (await req.json().catch(() => null)) as { status?: string; memo?: string; memo_version?: number } | null;
    if (!body || typeof body !== "object") return Response.json({ message: "수정 내용이 올바르지 않습니다." }, { status: 400 });
    const patch: Record<string, string> = {};
    if (body.status !== undefined) {
      if (!STATUSES.has(body.status)) return Response.json({ message: "알 수 없는 상태입니다." }, { status: 400 });
      patch.status = body.status;
    }
    if (body.memo !== undefined) patch.memo = String(body.memo).slice(0, 500);
    if (Object.keys(patch).length === 0) return Response.json({ message: "수정할 내용이 없습니다." }, { status: 400 });
    const { data, error } = await db().rpc("dm_patch_place", { p_board: board.id, p_id: params.id, p_who: board.who, p_patch: patch, p_expected: Number.isInteger(body.memo_version) ? body.memo_version : null });
    if (error) return Response.json({ message: error.message }, { status: 400 });
    if (!data || data.code === "PLACE_NOT_FOUND") return Response.json({ code: "PLACE_NOT_FOUND", message: "이미 삭제된 장소예요." }, { status: 404, headers: { "Cache-Control": "no-store" } });
    if (data.code === "MEMO_CONFLICT") return Response.json({ ...data, message: "메모가 먼저 바뀌었어요. 두 내용을 확인하고 저장해 주세요." }, { status: 409, headers: { "Cache-Control": "no-store" } });
    if (data.memo_changed) schedulePlacePushes(board.id);
    return Response.json({ ok: true, ...(body.memo !== undefined ? { memo_version: data.memo_version } : {}) }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return accessError(e);
  }
}

export async function DELETE(req: Request, { params: route }: { params: Promise<{ id: string }> }) {
  try {
    const params = await route;
    const board = await boardFromRequest(req);
    if (!board) return unauthorized();
    requireIdentity(board);
    const { data, error } = await db().rpc("dm_trash_place", { p_board: board.id, p_id: params.id, p_who: board.who, p_action: "trash" });
    if (error || !data?.ok) return Response.json({ message: "장소를 삭제하지 못했어요. 연결을 확인하고 다시 시도해 주세요." }, { status: 500, headers: { "Cache-Control": "no-store" } });
    return Response.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return accessError(e);
  }
}
