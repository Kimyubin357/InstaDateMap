import { NextResponse } from "next/server";
import { AccessError, accessError, boardFromRequest, unauthorized } from "@/lib/auth";
import { isUuid } from "@/lib/folders";
import { folderRpc } from "@/lib/folders-server";
import { schedulePlacePushes } from "@/lib/push-server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export interface CopyResult { to: string; folder: string; created: number; merged: number; place_ids: string[] }

/**
 * 지금 방의 장소를 다른 방에 담습니다(복사, 원래 방에도 그대로 남음). 옮기기 기능은 없습니다(담은 뒤 원래 방에서 지움).
 * body: { to: 방 id, ids: 장소 id 목록(1~100), from?: 장소가 있는 방 id } — 017_folder_transfer_push.sql의 dm_copy_places
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null) as { to?: unknown; ids?: unknown; from?: unknown } | null;
    // from: 전체 보기에서 다른 방의 장소를 담을 때 그 장소의 방(멤버 확인은 계정 id로). 없으면 이 기기가 연 방.
    const board = await boardFromRequest(req, isUuid(body?.from) ? body.from : undefined);
    if (!board) return unauthorized();
    if (!isUuid(body?.to)) throw new AccessError("담을 방을 골라 주세요.");
    const ids = Array.isArray(body?.ids) ? [...new Set(body.ids)] : [];
    if (!ids.length || ids.length > 100 || ids.some((id) => !isUuid(id))) throw new AccessError("장소를 1~100곳 골라 주세요.");
    const result = await folderRpc<CopyResult>("dm_copy_places", { p_user: board.userId, p_from: board.id, p_to: body.to, p_ids: ids },
      "장소를 담지 못했어요. 잠시 후 다시 시도해 주세요.");
    if (result.created) schedulePlacePushes(result.to);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return accessError(e); }
}
