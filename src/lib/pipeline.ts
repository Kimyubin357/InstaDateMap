import { AnalysisError, analysisMessage } from "./analysis-issue";
import { db } from "./db";
import { env } from "./env";
import { detectMediaType, fetchCaption, normalizeInstagramUrl } from "./instagram";
import { extractPlaces } from "./extract/router";
import type { SourceContext } from "./extract/types";
import { callLlm, type LlmCall } from "./llm";
import { isConfident, keywordSearch, resolveCandidate } from "./kakao";
import type { KakaoPlace } from "./types";
import { checkWork, SOURCE_MESSAGES } from "./source-work";
import { AccessError } from "./auth";
import { schedulePlacePushes } from "./push-server";

export interface ShareInput {
  boardId: string;
  owner: string;
  text: string; // 공유 시트에서 넘어온 텍스트(링크 포함)
  who: string;
  caption?: string | null;
  images?: SourceContext["images"];
  retry?: boolean;
  onProgress?: (stage: "caption" | "extract" | "search" | "save") => void;
}

/** 단축어가 읽는 응답. message는 알림으로 그대로 보여 줍니다. */
export interface ShareResponse {
  status: "saved" | "confirm" | "needs_caption" | "needs_review" | "duplicate" | "error" | "busy";
  message: string;
  code?: string;
  confirm_url?: string;
  source_id?: string;
  source_version?: string;
  place_url?: string;
}

const MAX_PLACES_PER_SOURCE = 8;

function checkDb(error: { message: string } | null, action: string) {
  if (error) throw new Error(`${action}: ${error.message}`);
}

export function confirmUrl(sourceId: string) {
  return `${env.baseUrl()}/confirm/${sourceId}`;
}

export function firstUrl(text: string): string | null {
  const m = text.match(/https?:\/\/[^\s"'<>]+/);
  return m ? m[0] : null;
}

/** 장소를 지도에 저장. 같은 카카오 장소면 새로 만들지 않고 공유 기록만 추가합니다. */
export async function savePlace(args: { boardId: string; sourceId: string | null; extractionId: string | null; place: KakaoPlace; addedBy: string }) {
  const { data, error } = await db().rpc("dm_save_place", { p_board: args.boardId, p_place: args.place, p_added_by: args.addedBy, p_source: args.sourceId, p_extraction: args.extractionId });
  checkDb(error, "장소 저장 실패");
  if (!data) throw new Error("장소 저장 결과가 없습니다.");
  schedulePlacePushes(args.boardId);
  return data as string;
}

export async function ingestShare(input: ShareInput, llm: LlmCall = callLlm): Promise<ShareResponse> {
  const raw = firstUrl(input.text) ?? input.text;
  const url = normalizeInstagramUrl(raw);
  if (!url) return { status: "error", message: "인스타그램 게시물이나 릴스 링크가 아닙니다." };

  const manualCaption = input.caption?.trim() || null;
  const images = input.images ?? [];

  const claimed = await db().rpc("dm_begin_source", { p_board: input.boardId, p_url: url, p_media: detectMediaType(url), p_who: input.who, p_owner: input.owner, p_retry: !!(input.retry || manualCaption || images.length) });
  checkDb(claimed.error, "링크 저장 실패");
  if (claimed.data.outcome === "busy") return { status: "busy", message: SOURCE_MESSAGES.SOURCE_BUSY };
  if (claimed.data.outcome === "trashed") return { status: "error", message: "이 링크의 장소는 삭제한 장소에 있어요. 설정에서 복구해 주세요." };
  const existing = claimed.data.source;
  const sourceId = existing.id as string;
  if (claimed.data.outcome === "duplicate" || claimed.data.outcome === "resume") {
    if (existing.status === "done") {
      // 연인이 이미 공유한 링크면 "둘 다 저장함"이 되도록 내 공유 기록도 남깁니다.
      const { data: links, error: linksError } = await db()
        .from("source_places")
        .select("place_id, extraction_id, places!inner(deleted_at)")
        .is("places.deleted_at", null).eq("source_id", existing.id);
      checkDb(linksError, "공유 기록 조회 실패");
      if (links?.length) {
        const { error } = await db()
          .from("source_places")
          .upsert(
            links.map((l) => ({ place_id: l.place_id, extraction_id: l.extraction_id, source_id: existing.id, added_by: input.who })),
            { onConflict: "source_id,place_id,added_by", ignoreDuplicates: true },
          );
        checkDb(error, "공유 기록 저장 실패");
        const { error: saveError } = await db().from("place_saves").upsert(links.map((l) => ({ board_id: input.boardId, place_id: l.place_id, added_by: input.who })), { onConflict: "place_id,added_by", ignoreDuplicates: true });
        checkDb(saveError, "저장자 기록 실패");
        return { status: "duplicate", message: "이미 지도에 있는 링크예요.", source_id: existing.id, place_url: `/?place=${links[0].place_id}` };
      }
      // 핀을 삭제했거나 이전 저장이 끝나지 않았다면 다시 처리합니다.
    }
    if (existing.status === "pending_confirm" || existing.status === "needs_review" || existing.status === "needs_caption") {
      return {
        status: existing.status === "pending_confirm" ? "confirm" : existing.status,
        code: analysisMessage(existing.recovery_reason) ? existing.recovery_reason : undefined,
        message: analysisMessage(existing.recovery_reason) ?? (existing.status === "pending_confirm" ? "확인이 남아 있는 링크예요. 지점을 골라 저장하거나 다른 방법으로 다시 찾을 수 있어요."
          : existing.status === "needs_caption" ? "아직 게시물 내용을 읽지 못한 링크예요. 캡션·스크린샷을 보태거나 장소를 직접 검색해 주세요."
          : "장소 확인이 필요한 링크예요. 다시 시도하거나 캡션·스크린샷·직접 검색으로 이어갈 수 있어요."),
        confirm_url: confirmUrl(existing.id),
        source_id: existing.id, source_version: existing.analysis_version,
      };
    }
  }

  let caption = manualCaption || existing.caption || null;
  let method = manualCaption ? "manual" : existing.caption_method ?? null;
  let locationTag = existing.location_tag ?? null;
  const finish = async (status: string, rows: unknown[] | null, auto = false, reason: string | null = null) => {
    const { data, error } = await db().rpc("dm_finish_analysis", { p_board: input.boardId, p_source: sourceId, p_owner: input.owner,
      p_version: existing.analysis_version, p_status: status, p_caption: caption, p_method: method, p_location: locationTag,
      p_rows: rows, p_auto: auto, p_who: input.who, p_reason: reason });
    checkWork(error); return data;
  };
  try {
    input.onProgress?.("caption");
    if (!caption) { const r = await fetchCaption(url); caption = r.caption; method = r.method; locationTag = r.locationTag; }
    if (!caption && !locationTag && images.length === 0) {
      await finish("needs_caption", []);
      return { status: "needs_caption", message: "캡션을 가져오지 못했어요. 캡션·스크린샷을 보태거나 직접 검색해 주세요.", source_id: sourceId, source_version: existing.analysis_version, confirm_url: confirmUrl(sourceId) };
    }
    const ctx: SourceContext = {
      url,
      mediaType: detectMediaType(url),
      caption,
      locationTag,
      images,
      videos: [],
    };
    input.onProgress?.("extract");
    const { candidates, errors } = await extractPlaces(ctx, { llm });
    const issue = errors.find((error) => error.code)?.code;
    if (!candidates.length && issue) throw new AnalysisError(issue);
    if (errors.length) console.error("장소 추출 실패", { sourceId, errors });
    if (candidates.length === 0 && errors.length) throw new Error("AI 장소 분석에 실패했어요. 잠시 후 다시 시도하거나 장소를 직접 검색해 주세요.");
    const top = candidates.slice(0, MAX_PLACES_PER_SOURCE);

    input.onProgress?.("search");
    const resolved = await Promise.all(
      top.map(async (c) => ({ c, places: await resolveCandidate(c) })),
    );

    const rows = resolved.map(({ c, places }) => ({
      source_id: sourceId,
      module: c.module,
      raw_name: c.name,
      branch: c.branch,
      raw_address: c.address,
      area_hint: c.areaHint,
      category: c.category,
      confidence: c.confidence,
      evidence: c.evidence,
      candidates: places,
    }));
    const withPlaces = resolved.filter((r) => r.places.length > 0);

    if (withPlaces.length === 0) {
      await finish("needs_review", rows, false, issue ?? null);
      return {
        status: "needs_review",
        code: issue,
        message: analysisMessage(issue) ?? (top.length
          ? "장소 이름은 찾았지만 지도에서 못 찾았어요. 확인 화면에서 직접 검색해 주세요."
          : "장소 정보를 찾지 못했어요. 확인 화면에서 직접 검색해 주세요."),
        confirm_url: confirmUrl(sourceId),
        source_id: sourceId, source_version: existing.analysis_version,
      };
    }

    // 장소가 하나이고 확실하면 바로 저장
    if (!issue && resolved.length === 1 && isConfident(resolved[0].c, resolved[0].places)) {
      const place = resolved[0].places[0];
      input.onProgress?.("save");
      const result = await finish("done", rows, true);
      const placeId = result.place_id;
      schedulePlacePushes(input.boardId);
      return { status: "saved", message: `${place.name}을(를) 지도에 저장했어요.`, source_id: sourceId, source_version: existing.analysis_version, place_url: `/?place=${placeId}` };
    }

    await finish("pending_confirm", rows, false, issue ?? null);
    const n = resolved.length;
    return {
      status: "confirm",
      code: issue,
      message: issue ? `${analysisMessage(issue)} 확인 가능한 후보는 아래에 남겼어요.` : n > 1 ? `장소 ${n}곳을 찾았어요. 남길 곳을 골라 주세요.` : "어느 지점인지 골라 주세요.",
      confirm_url: confirmUrl(sourceId),
      source_id: sourceId, source_version: existing.analysis_version,
    };
  } catch (e) {
    // 실패한 링크도 지도에서 다시 찾거나 직접 검색할 수 있어야 합니다.
    try { await finish("needs_review", null, false, e instanceof AnalysisError ? e.code : "interrupted"); }
    catch { console.warn("중단된 링크 복구 대기", { sourceId }); }
    console.error("링크 처리 실패", { sourceId, message: e instanceof Error ? e.message : String(e) });
    return { status: "error", code: e instanceof AnalysisError ? e.code : undefined, message: e instanceof Error ? e.message : "장소 저장에 실패했어요.", source_id: sourceId, source_version: existing.analysis_version,
      confirm_url: confirmUrl(sourceId) };
  }
}

export interface Selection { extraction_id: string; include: boolean; place_id?: string | null; query?: string }
export interface DirectSelection { place_id: string; query: string }
async function searchedPlace(selection: DirectSelection) {
  if (typeof selection.query !== "string" || !selection.query.trim() || selection.query.length > 100 || typeof selection.place_id !== "string") throw new AccessError("검색한 장소를 골라 주세요.");
  const place = (await keywordSearch(selection.query.trim())).find((p) => p.kakao_place_id === selection.place_id);
  if (!place) throw new AccessError("검색 결과가 바뀌었어요. 다시 검색해서 골라 주세요.", 409);
  return place;
}
export async function confirmSelections(boardId: string, sourceId: string, who: string, selections: Selection[], direct: DirectSelection | null, owner: string, version: string) {
  const { data: src, error } = await db().from("sources").select("id, analysis_version").eq("id", sourceId).eq("board_id", boardId).maybeSingle();
  checkDb(error, "링크 조회 실패");
  if (!src) throw new AccessError(SOURCE_MESSAGES.SOURCE_NOT_FOUND, 404);
  if (src.analysis_version !== version) throw new AccessError(SOURCE_MESSAGES.SOURCE_STALE, 409);
  const result = await db().from("extractions").select("id, candidates").eq("source_id", sourceId);
  checkDb(result.error, "장소 후보 조회 실패");
  const allowed = new Map((result.data ?? []).map((e) => [e.id, e.candidates as KakaoPlace[]]));
  if (new Set(selections.map((s) => s.extraction_id)).size !== selections.length || selections.some((s) => !allowed.has(s.extraction_id))) throw new AccessError("이 링크의 장소 후보가 아닙니다. 화면을 새로 열어 주세요.", 409);
  const resolved = await Promise.all(selections.map(async (s) => {
    if (!s.include) return { extraction_id: s.extraction_id, include: false, place: null };
    const stored = allowed.get(s.extraction_id)?.find((p) => p.kakao_place_id === s.place_id);
    const place = stored || (s.query && s.place_id ? await searchedPlace({ query: s.query, place_id: s.place_id }) : null);
    if (!place) throw new AccessError("선택한 장소가 후보에 없어요. 다시 골라 주세요.");
    return { extraction_id: s.extraction_id, include: true, place };
  }));
  const directPlace = direct ? await searchedPlace(direct) : null;
  const saved = await db().rpc("dm_confirm_source", { p_board: boardId, p_source: sourceId, p_owner: owner, p_version: version,
    p_who: who, p_selections: resolved, p_direct: directPlace });
  checkWork(saved.error); schedulePlacePushes(boardId); return saved.data as number;
}
