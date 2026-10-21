import { boardFromRequest, unauthorized } from "@/lib/auth";
import { db } from "@/lib/db";

export const runtime = "nodejs";

const STATUSES = new Set(["wish", "visited", "again", "meh"]);

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const board = await boardFromRequest(req);
    if (!board) return unauthorized();
    const body = (await req.json().catch(() => null)) as { status?: string; memo?: string } | null;
    if (!body || typeof body !== "object") return Response.json({ message: "수정 내용이 올바르지 않습니다." }, { status: 400 });
    const patch: Record<string, string> = {};
    if (body.status !== undefined) {
      if (!STATUSES.has(body.status)) return Response.json({ message: "알 수 없는 상태입니다." }, { status: 400 });
      patch.status = body.status;
    }
    if (body.memo !== undefined) patch.memo = String(body.memo).slice(0, 500);
    if (Object.keys(patch).length === 0) return Response.json({ message: "수정할 내용이 없습니다." }, { status: 400 });
    const { error } = await db().from("places").update(patch).eq("id", params.id).eq("board_id", board.id);
    if (error) return Response.json({ message: error.message }, { status: 400 });
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ message: e instanceof Error ? e.message : "수정하지 못했어요." }, { status: 500 });
  }
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  try {
    const board = await boardFromRequest(req);
    if (!board) return unauthorized();
    const { error } = await db().from("places").delete().eq("id", params.id).eq("board_id", board.id);
    if (error) return Response.json({ message: error.message }, { status: 400 });
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ message: e instanceof Error ? e.message : "삭제하지 못했어요." }, { status: 500 });
  }
}
