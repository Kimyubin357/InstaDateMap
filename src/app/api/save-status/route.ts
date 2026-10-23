import { analysisMessage } from "@/lib/analysis-issue";
import { AccessError, accessError, boardFromRequest, requireIdentity, unauthorized } from "@/lib/auth";
import { db } from "@/lib/db";
import { normalizeInstagramUrl } from "@/lib/instagram";
import { withSavedPlace } from "@/lib/saved-place-server";
import type { ShareResult } from "@/lib/share-stream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function check(error: { message: string } | null) {
  if (error) throw new Error("저장 여부를 확인하지 못했어요. 연결을 확인하고 다시 확인해 주세요.");
}
const reply = (body: unknown) => Response.json(body, { headers: { "Cache-Control": "no-store" } });
const empty = { result: null, source: null, selections: [], linked: [] };

/** Read only: an interrupted response never triggers another save or notification. */
export async function GET(req: Request) {
  try {
    const board = await boardFromRequest(req);
    if (!board) { const res = unauthorized(); res.headers.set("Cache-Control", "no-store"); return res; }
    requireIdentity(board);
    const params = new URL(req.url).searchParams;
    const sourceId = params.get("source_id"), rawUrl = params.get("url"), kakaoId = params.get("kakao_place_id");
    if ([sourceId, rawUrl, kakaoId].filter((value) => value !== null).length !== 1) throw new AccessError("확인할 장소나 링크 하나를 지정해 주세요.");

    if (kakaoId !== null) {
      if (!/^[A-Za-z0-9_-]{1,100}$/.test(kakaoId)) throw new AccessError("장소 정보가 올바르지 않아요.");
      const place = await db().from("places").select("id").is("deleted_at", null).eq("board_id", board.id).eq("kakao_place_id", kakaoId).maybeSingle();
      check(place.error);
      if (!place.data) return reply(empty);
      const save = await db().from("place_saves").select("place_id").eq("board_id", board.id).eq("place_id", place.data.id).eq("added_by", board.who).maybeSingle();
      check(save.error);
      if (!save.data) return reply(empty);
      const result = await withSavedPlace(board, { status: "saved", message: "저장한 장소를 확인했어요.", place_url: `/?place=${encodeURIComponent(place.data.id)}` });
      return reply({ ...empty, result });
    }

    if (sourceId !== null && !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(sourceId)) throw new AccessError("링크 정보가 올바르지 않아요.");
    const candidate = rawUrl?.match(/https?:\/\/[^\s"'<>]+/)?.[0];
    const url = candidate ? normalizeInstagramUrl(candidate) : null;
    if (rawUrl !== null && (rawUrl.length > 4000 || !url)) throw new AccessError("인스타그램 게시물이나 릴스 링크를 입력해 주세요.");
    const query = db().from("sources").select("id, status, analysis_version, recovery_reason").eq("board_id", board.id);
    const source = await (sourceId !== null ? query.eq("id", sourceId) : query.eq("url", url!)).maybeSingle();
    check(source.error);
    if (!source.data) return reply(empty);

    const [extractions, links] = await Promise.all([
      db().from("extractions").select("id, excluded").eq("source_id", source.data.id),
      db().from("source_places").select("place_id, extraction_id").eq("source_id", source.data.id).eq("added_by", board.who),
    ]);
    check(extractions.error); check(links.error);
    const ids = [...new Set((links.data ?? []).map((link) => link.place_id as string))];
    const places = ids.length ? await db().from("places").select("id, kakao_place_id").is("deleted_at", null).eq("board_id", board.id).in("id", ids) : { data: [], error: null };
    check(places.error);
    const currentPlaces = new Map((places.data ?? []).map((place) => [place.id, place]));
    const linked = (links.data ?? []).flatMap((link) => {
      const place = currentPlaces.get(link.place_id);
      return place?.kakao_place_id ? [{ kakao_place_id: place.kakao_place_id as string, extraction_id: link.extraction_id ?? null }] : [];
    });
    const selections = (extractions.data ?? []).map((extraction) => ({ id: extraction.id, excluded: extraction.excluded === true }));
    const currentSource = { id: source.data.id as string, status: source.data.status as string };
    let result: ShareResult | null = null;
    if (currentSource.status === "done" && linked.length) {
      const first = (links.data ?? []).find((link) => currentPlaces.get(link.place_id)?.kakao_place_id)!;
      result = await withSavedPlace(board, { status: "saved", message: "저장한 장소를 확인했어요.", source_id: currentSource.id, place_url: `/?place=${encodeURIComponent(first.place_id)}` });
    } else if (["pending_confirm", "needs_review", "needs_caption"].includes(currentSource.status)) {
      result = { status: currentSource.status === "pending_confirm" ? "confirm" : currentSource.status,
        code: analysisMessage(source.data.recovery_reason) ? source.data.recovery_reason : undefined,
        message: analysisMessage(source.data.recovery_reason) ?? "링크 처리 결과를 확인했어요. 남은 확인을 이어서 해 주세요.", source_id: currentSource.id, source_version: source.data.analysis_version, confirm_url: `/confirm/${currentSource.id}` };
    }
    return reply({ result, source: currentSource, selections, linked });
  } catch (error) { return accessError(error); }
}
