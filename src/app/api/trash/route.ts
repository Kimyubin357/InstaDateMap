import { boardFromRequest, requireIdentity, unauthorized, accessError } from "@/lib/auth";
import { db } from "@/lib/db";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  try {
    const board = await boardFromRequest(req);
    if (!board) return unauthorized();
    requireIdentity(board);
    const { data, error } = await db().from("places").select("id, name, address, memo, status, deleted_at, deleted_by")
      .eq("board_id", board.id).not("deleted_at", "is", null).order("deleted_at", { ascending: false });
    if (error) throw new Error("삭제한 장소를 불러오지 못했어요. 다시 시도해 주세요.");
    return Response.json({ places: data ?? [] }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return accessError(error); }
}
