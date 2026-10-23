import { boardFromRequest, unauthorized, requireIdentity, accessError } from "@/lib/auth";
import { db } from "@/lib/db";
import { confirmSelections, type DirectSelection, type Selection } from "@/lib/pipeline";
import { workOwner } from "@/lib/source-work";
import { withSavedPlace } from "@/lib/saved-place-server";


export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request, { params: route }: { params: Promise<{ id: string }> }) {
  try {
    const params = await route;
    const board = await boardFromRequest(req);
    if (!board) return unauthorized();
    requireIdentity(board);
    const body = (await req.json().catch(() => null)) as { who?: string; selections?: Selection[]; direct?: DirectSelection; version?: string; work_id?: string } | null;
    if (!body || !Array.isArray(body.selections)) {
      return Response.json({ status: "error", message: "선택 내용이 없습니다." }, { status: 400 });
    }
    if (body.selections.some((s) => !s || typeof s.extraction_id !== "string" || typeof s.include !== "boolean")) {
      return Response.json({ status: "error", message: "선택 내용이 올바르지 않습니다." }, { status: 400 });
    }
    const selections = body.selections;
    const direct = body.direct ?? null;
    const saved = await confirmSelections(board.id, params.id, board.who, selections, direct, workOwner(board, body.work_id), body.version || "");
    const { data: links } = saved ? await db().from("source_places").select("place_id").eq("source_id", params.id).eq("added_by", board.who).limit(1) : { data: [] };
    return Response.json(await withSavedPlace(board, { status: "ok", saved, place_url: links?.[0] ? `/?place=${links[0].place_id}` : "/" }), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return accessError(e);
  }
}
