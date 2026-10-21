import { boardFromRequest, unauthorized } from "@/lib/auth";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 지도에 필요한 것: 장소 + 원본 링크 + 공유자, 그리고 확인이 필요한 링크 */
export async function GET(req: Request) {
  try {
    const board = await boardFromRequest(req);
    if (!board) return unauthorized();

    const [placeResult, linkResult, pendingResult] = await Promise.all([
      db()
        .from("places")
        .select("id, name, address, lat, lng, category, kakao_url, status, memo, created_at")
        .eq("board_id", board.id)
        .order("created_at", { ascending: false }),
      db()
        .from("source_places")
        .select("place_id, added_by, sources!inner(id, url, media_type, board_id)")
        .eq("sources.board_id", board.id),
      db()
        .from("sources")
        .select("id, url, status, shared_by, shared_at")
        .eq("board_id", board.id)
        .in("status", ["pending_confirm", "needs_review", "needs_caption"])
        .order("shared_at", { ascending: false }),
    ]);
    const error = [placeResult, linkResult, pendingResult].find((r) => r.error)?.error;
    if (error) throw new Error("장소를 불러오지 못했어요. 데이터베이스 연결을 확인해 주세요.");
    const { data: places } = placeResult;
    const { data: links } = linkResult;
    const { data: pending } = pendingResult;

    type Link = { place_id: string; added_by: string; sources: { id: string; url: string; media_type: string } };
    const byPlace = new Map<string, { sharers: Set<string>; sources: Map<string, { url: string; media_type: string }> }>();
    for (const l of (links ?? []) as unknown as Link[]) {
      const e = byPlace.get(l.place_id) ?? { sharers: new Set(), sources: new Map() };
      e.sharers.add(l.added_by);
      e.sources.set(l.sources.id, { url: l.sources.url, media_type: l.sources.media_type });
      byPlace.set(l.place_id, e);
    }

    return Response.json({
      board: board.name,
      places: (places ?? []).map((p) => {
        const e = byPlace.get(p.id);
        return {
          ...p,
          sharers: e ? [...e.sharers] : [],
          sources: e ? [...e.sources.values()] : [],
        };
      }),
      pending: pending ?? [],
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return Response.json({ message: e instanceof Error ? e.message : "장소를 불러오지 못했어요." }, { status: 500 });
  }
}
