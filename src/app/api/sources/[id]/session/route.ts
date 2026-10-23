import { accessError, AccessError, boardFromRequest, requireIdentity, unauthorized } from "@/lib/auth";
import { db } from "@/lib/db";
import { checkWork, workOwner } from "@/lib/source-work";
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const board = await boardFromRequest(req);
    if (!board) return unauthorized();
    requireIdentity(board);
    const body = await req.json().catch(() => null);
    if (!body || !["claim", "release", "dismiss"].includes(body.action) || typeof body.version !== "string") throw new AccessError("링크 상태를 다시 확인해 주세요.");
    const { data, error } = await db().rpc("dm_source_session", { p_board: board.id, p_source: (await params).id,
      p_owner: workOwner(board, body.work_id), p_version: body.version, p_action: body.action });
    checkWork(error, data);
    return Response.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return accessError(e); }
}
