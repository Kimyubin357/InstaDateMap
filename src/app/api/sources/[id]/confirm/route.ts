import { boardFromRequest, unauthorized } from "@/lib/auth";
import { confirmSelections, type Selection } from "@/lib/pipeline";
import type { KakaoPlace } from "@/lib/types";

function isPlace(v: unknown): v is KakaoPlace {
  const p = v as KakaoPlace;
  return !!p && typeof p.kakao_place_id === "string" && Number.isFinite(p.lat) && Number.isFinite(p.lng) && typeof p.name === "string";
}

export const runtime = "nodejs";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const board = await boardFromRequest(req);
    if (!board) return unauthorized();
    const body = (await req.json().catch(() => null)) as { who?: string; selections?: Selection[]; direct?: unknown } | null;
    if (!body || !Array.isArray(body.selections)) {
      return Response.json({ status: "error", message: "선택 내용이 없습니다." }, { status: 400 });
    }
    if (body.selections.some((s) => !s || typeof s.extraction_id !== "string" || typeof s.include !== "boolean")) {
      return Response.json({ status: "error", message: "선택 내용이 올바르지 않습니다." }, { status: 400 });
    }
    const selections = body.selections.map((s) => ({ ...s, place: isPlace(s.place) ? s.place : null }));
    const direct = isPlace(body.direct) ? body.direct : null;
    const saved = await confirmSelections(board.id, params.id, (typeof body.who === "string" && body.who || "익명").slice(0, 20), selections, direct);
    return Response.json({ status: "ok", saved });
  } catch (e) {
    return Response.json({ status: "error", message: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
