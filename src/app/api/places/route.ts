import { boardFromRequest, unauthorized, requireIdentity, AccessError, accessError } from "@/lib/auth";
import { recoverSources } from "@/lib/source-work";
import { db } from "@/lib/db";
import { keywordSearch, keywordSearchPage } from "@/lib/kakao";
import { validSearchPage } from "@/lib/search-page";
import { savePlace } from "@/lib/pipeline";
import { boardRevision } from "@/lib/sync-server";
import { snapshotEtag } from "@/lib/sync-types";
import { withSavedPlace } from "@/lib/saved-place-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** 지도에 필요한 것: 장소 + 원본 링크 + 공유자, 그리고 확인이 필요한 링크 */
export async function GET(req: Request) {
  try {
    const board = await boardFromRequest(req);
    if (!board) return unauthorized();
    await recoverSources(board.id);
    for (let attempt = 0; attempt < 3; attempt++) {
    const revision = await boardRevision(board.id);
    const etag = snapshotEtag({ boardId: board.id, authVersion: board.authVersion, revision });
    if (req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers: { ETag: etag, "Cache-Control": "no-store" } });
    const [placeResult, linkResult, pendingResult, saveResult] = await Promise.all([
      db()
        .from("places")
        .select("id, name, address, lat, lng, category, kakao_place_id, kakao_url, status, memo, memo_version, created_at").is("deleted_at", null)
        .eq("board_id", board.id)
        .order("created_at", { ascending: false }),
      db()
        .from("source_places")
        .select("place_id, added_by, sources!inner(id, url, media_type, board_id)")
        .eq("sources.board_id", board.id),
      db()
        .from("sources")
        .select("id, url, status, shared_by, shared_at, analysis_version, recovery_reason")
        .eq("board_id", board.id)
        .in("status", ["pending_confirm", "needs_review", "needs_caption"])
        .order("shared_at", { ascending: false }),
      db().from("place_saves").select("place_id, added_by, added_at").eq("board_id", board.id),
    ]);
    const error = [placeResult, linkResult, pendingResult, saveResult].find((r) => r.error)?.error;
    if (error) { console.error("GET /api/places failed", error.code, error.message); throw new Error("장소를 불러오지 못했어요. 잠시 후 다시 시도해 주세요."); }
    const { data: places } = placeResult;
    const { data: links } = linkResult;
    const { data: pending } = pendingResult;
    const pendingIds = (pending ?? []).map((source) => source.id);
    const candidateNames = pendingIds.length ? await db().from("extractions").select("source_id, raw_name, branch").in("source_id", pendingIds) : { data: [], error: null };
    const namesBySource = new Map<string, Set<string>>();
    if (!candidateNames.error) for (const row of candidateNames.data ?? []) {
      const names = namesBySource.get(row.source_id) ?? new Set<string>();
      const name = [row.raw_name, row.branch].filter(Boolean).join(" ").trim();
      if (name) names.add(name);
      namesBySource.set(row.source_id, names);
    }

    type Link = { place_id: string; added_by: string; sources: { id: string; url: string; media_type: string } };
    const byPlace = new Map<string, { sharers: Set<string>; sources: Map<string, { url: string; media_type: string }> }>();
    for (const l of (links ?? []) as unknown as Link[]) {
      const e = byPlace.get(l.place_id) ?? { sharers: new Set(), sources: new Map() };
      e.sharers.add(l.added_by);
      e.sources.set(l.sources.id, { url: l.sources.url, media_type: l.sources.media_type });
      byPlace.set(l.place_id, e);
    }
    const latest = new Map<string, string>();
    for (const s of saveResult.data ?? []) {
      const e = byPlace.get(s.place_id) ?? { sharers: new Set<string>(), sources: new Map<string, { url: string; media_type: string }>() };
      e.sharers.add(s.added_by); byPlace.set(s.place_id, e);
      if (!latest.has(s.place_id) || s.added_at > latest.get(s.place_id)!) latest.set(s.place_id, s.added_at);
    }

    if (await boardRevision(board.id) !== revision) continue;
    return Response.json({
      boardId: board.id, authVersion: board.authVersion, revision,
      board: board.name,
      places: (places ?? []).map((p) => {
        const e = byPlace.get(p.id);
        return {
          ...p,
          kakao_place_id: p.kakao_place_id ?? null,
          sharers: e ? [...e.sharers] : [],
          sources: e ? [...e.sources.values()] : [],
          last_saved_at: latest.get(p.id) || p.created_at,
        };
      }),
      pending: (pending ?? []).map((source) => ({ ...source, place_names: [...(namesBySource.get(source.id) ?? [])] })),
    }, { headers: { "Cache-Control": "no-store", ETag: etag } });
    }
    return Response.json({ status: "error", message: "변경 내용을 맞추는 중이에요. 잠시 후 다시 확인할게요." }, { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "1" } });
  } catch (e) {
    return accessError(e);
  }
}

export async function POST(req: Request) {
  try {
    const board = await boardFromRequest(req);
    if (!board) return unauthorized();
    requireIdentity(board);
    const body = await req.json().catch(() => null);
    if (typeof body?.query !== "string" || !body.query.trim() || body.query.length > 100 || typeof body?.place_id !== "string") throw new AccessError("검색한 장소를 골라 주세요.");
    const page = body.page ?? 1;
    if (!validSearchPage(page)) throw new AccessError("검색 결과 페이지가 올바르지 않아요.");
    const places = page === 1 ? await keywordSearch(body.query.trim()) : (await keywordSearchPage(body.query.trim(), page)).places;
    const place = places.find((p) => p.kakao_place_id === body.place_id);
    if (!place) throw new AccessError("검색 결과가 바뀌었어요. 다시 검색해서 골라 주세요.", 409);
    const { data: existing, error } = await db().from("places").select("id").is("deleted_at", null).eq("board_id", board.id).eq("kakao_place_id", place.kakao_place_id).maybeSingle();
    if (error) throw new Error("기존 장소를 확인하지 못했어요.");
    const id = await savePlace({ boardId: board.id, sourceId: null, extractionId: null, addedBy: board.who, place });
    return Response.json(await withSavedPlace(board, { status: existing ? "duplicate" : "saved", place_url: `/?place=${id}`, message: existing ? "이미 있는 장소에 저장한 마음을 더했어요." : `${place.name}을(를) 저장했어요.` }), { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return accessError(e); }
}
