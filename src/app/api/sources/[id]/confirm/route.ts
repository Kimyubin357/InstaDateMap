import { boardFromRequest, unauthorized, requireIdentity, accessError } from "@/lib/auth";
import { db } from "@/lib/db";
import { confirmSelections, type Selection } from "@/lib/pipeline";
import type { KakaoPlace } from "@/lib/types";
import { withSavedPlace } from "@/lib/saved-place-server";

function isPlace(v: unknown): v is KakaoPlace {
  const p = v as KakaoPlace;
  return !!p && typeof p.kakao_place_id === "string" && Number.isFinite(p.lat) && Number.isFinite(p.lng) && typeof p.name === "string";
}

export const runtime = "nodejs";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const board = await boardFromRequest(req);
    if (!board) return unauthorized();
    requireIdentity(board);
    const body = (await req.json().catch(() => null)) as { who?: string; selections?: Selection[]; direct?: unknown } | null;
    if (!body || !Array.isArray(body.selections)) {
      return Response.json({ status: "error", message: "선택 내용이 없습니다." }, { status: 400 });
    }
    if (body.selections.some((s) => !s || typeof s.extraction_id !== "string" || typeof s.include !== "boolean")) {
      return Response.json({ status: "error", message: "선택 내용이 올바르지 않습니다." }, { status: 400 });
    }
    const selections = body.selections.map((s) => ({ ...s, place: isPlace(s.place) ? s.place : null }));
    const direct = isPlace(body.direct) ? body.direct : null;
    const saved = await confirmSelections(board.id, params.id, board.who, selections, direct);
    const { data: links } = saved ? await db().from("source_places").select("place_id").eq("source_id", params.id).eq("added_by", board.who).limit(1) : { data: [] };
    return Response.json(await withSavedPlace(board, { status: "ok", saved, place_url: links?.[0] ? `/?place=${links[0].place_id}` : "/" }), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return accessError(e);
  }
}
