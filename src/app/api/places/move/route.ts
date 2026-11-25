import { NextResponse } from "next/server";
import { AccessError, accessError, boardFromRequest, unauthorized } from "@/lib/auth";
import { isUuid } from "@/lib/folders";
import { folderRpc } from "@/lib/folders-server";
import { schedulePlacePushes } from "@/lib/push-server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export interface MoveResult { to: string; from: string; folder: string; created: number; merged: number; place_ids: string[]; moved_ids: string[] }

/**
 * 지금 방의 장소를 다른 방으로 옮깁니다(지금 방에서는 빠짐, 2026-11-25 사용자 결정). 처음 등록한 사람만 옮길 수 있습니다(삭제와 같은 규칙).
 * 두 방에 같이 두려면 인스타 링크로 다른 방에 한 번 더 저장합니다.
 * body: { to: 방 id, ids: 장소 id 목록(1~100), from?: 장소가 있는 방 id } — 022_move_places.sql의 dm_move_places
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null) as { to?: unknown; ids?: unknown; from?: unknown } | null;
    // from: 전체 보기에서 다른 방의 장소를 옮길 때 그 장소의 방(멤버 확인은 계정 id로). 없으면 이 기기가 연 방.
    const board = await boardFromRequest(req, isUuid(body?.from) ? body.from : undefined);
    if (!board) return unauthorized();
    if (!isUuid(body?.to)) throw new AccessError("옮길 방을 골라 주세요.");
    const ids = Array.isArray(body?.ids) ? [...new Set(body.ids)] : [];
    if (!ids.length || ids.length > 100 || ids.some((id) => !isUuid(id))) throw new AccessError("장소를 1~100곳 골라 주세요.");
    const result = await folderRpc<MoveResult>("dm_move_places", { p_user: board.userId, p_from: board.id, p_to: body.to, p_ids: ids },
      "장소를 옮기지 못했어요. 잠시 후 다시 시도해 주세요.");
    if (result.created) schedulePlacePushes(result.to);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return accessError(e); }
}
