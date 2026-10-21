import { db } from "./db";
import { env } from "./env";
import { detectMediaType, fetchCaption, normalizeInstagramUrl } from "./instagram";
import { extractPlaces } from "./extract/router";
import type { SourceContext } from "./extract/types";
import { callLlm, type LlmCall } from "./llm";
import { isConfident, resolveCandidate } from "./kakao";
import type { KakaoPlace } from "./types";

export interface ShareInput {
  boardId: string;
  text: string; // 공유 시트에서 넘어온 텍스트(링크 포함)
  who: string;
  caption?: string | null;
  images?: SourceContext["images"];
  retry?: boolean;
  onProgress?: (stage: "caption" | "extract" | "search" | "save") => void;
}

/** 단축어가 읽는 응답. message는 알림으로 그대로 보여 줍니다. */
export interface ShareResponse {
  status: "saved" | "confirm" | "needs_caption" | "needs_review" | "duplicate" | "error";
  message: string;
  confirm_url?: string;
  source_id?: string;
  place_url?: string;
}

const MAX_PLACES_PER_SOURCE = 8;

function checkDb(error: { message: string } | null, action: string) {
  if (error) throw new Error(`${action}: ${error.message}`);
}

async function setSourceStatus(sourceId: string, status: string) {
  const { error } = await db().from("sources").update({ status }).eq("id", sourceId);
  checkDb(error, "링크 상태 저장 실패");
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
  return data as string;
}

export async function ingestShare(input: ShareInput, llm: LlmCall = callLlm): Promise<ShareResponse> {
  const raw = firstUrl(input.text) ?? input.text;
  const url = normalizeInstagramUrl(raw);
  if (!url) return { status: "error", message: "인스타그램 게시물이나 릴스 링크가 아닙니다." };

  const manualCaption = input.caption?.trim() || null;
  const images = input.images ?? [];

  // 이미 처리한 링크인지 확인
  const { data: existing, error: existingError } = await db()
    .from("sources")
    .select("id, status, caption, caption_method, location_tag, shared_by")
    .eq("board_id", input.boardId)
    .eq("url", url)
    .maybeSingle();
  checkDb(existingError, "기존 링크 조회 실패");

  const retrying = input.retry || !!manualCaption || images.length > 0;
  if (existing && !retrying) {
    if (existing.status === "done") {
      // 연인이 이미 공유한 링크면 "둘 다 저장함"이 되도록 내 공유 기록도 남깁니다.
      const { data: links, error: linksError } = await db()
        .from("source_places")
        .select("place_id, extraction_id")
        .eq("source_id", existing.id);
      checkDb(linksError, "공유 기록 조회 실패");
      if (links?.length) {
        const { error } = await db()
          .from("source_places")
          .upsert(
            links.map((l) => ({ ...l, source_id: existing.id, added_by: input.who })),
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
        status: "confirm",
        message: "확인이 남아 있는 링크예요.",
        confirm_url: confirmUrl(existing.id),
        source_id: existing.id,
      };
    }
  }

  input.onProgress?.("caption");
  // 캡션 확보
  let caption = manualCaption || existing?.caption || null;
  let method: "og" | "oembed" | "manual" | null = manualCaption ? "manual" : existing?.caption_method ?? null;
  let locationTag: string | null = existing?.location_tag ?? null;
  if (!caption) {
    const r = await fetchCaption(url);
    caption = r.caption;
    method = r.method;
    locationTag = r.locationTag;
  }

  const sourceRow = {
    board_id: input.boardId,
    url,
    media_type: detectMediaType(url),
    caption,
    caption_method: method,
    location_tag: locationTag,
    shared_by: existing?.shared_by || input.who,
  };

  if (!caption && !locationTag && images.length === 0) {
    const { data, error } = await db()
      .from("sources")
      .upsert({ ...sourceRow, status: "needs_caption" }, { onConflict: "board_id,url" })
      .select("id")
      .single();
    checkDb(error, "링크 저장 실패");
    if (!data) throw new Error("링크 저장 결과가 없습니다.");
    return {
      status: "needs_caption",
      message: "캡션을 가져오지 못했어요. 열리는 화면에 캡션을 붙여넣어 주세요.",
      confirm_url: data?.id ? confirmUrl(data.id) : undefined,
      source_id: data?.id,
    };
  }

  const { data: src, error: srcErr } = await db()
    .from("sources")
    .upsert({ ...sourceRow, status: "processing" }, { onConflict: "board_id,url" })
    .select("id")
    .single();
  if (srcErr || !src) return { status: "error", message: `저장 실패: ${srcErr?.message}` };
  const sourceId = src.id as string;

  try {
    // 다시 처리하는 경우 이전 추출 결과를 지웁니다.
    const { error: deleteError } = await db().from("extractions").delete().eq("source_id", sourceId);
    checkDb(deleteError, "기존 후보 정리 실패");

    const ctx: SourceContext = {
      url,
      mediaType: sourceRow.media_type,
      caption,
      locationTag,
      images,
      videos: [],
    };
    input.onProgress?.("extract");
    const { candidates, errors } = await extractPlaces(ctx, { llm });
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
    const { data: inserted, error: insertError } = rows.length
      ? await db().from("extractions").insert(rows).select("id")
      : { data: [] as { id: string }[], error: null };
    checkDb(insertError, "장소 후보 저장 실패");

    const withPlaces = resolved.filter((r) => r.places.length > 0);

    if (withPlaces.length === 0) {
      await setSourceStatus(sourceId, "needs_review");
      return {
        status: "needs_review",
        message: top.length
          ? "장소 이름은 찾았지만 지도에서 못 찾았어요. 확인 화면에서 직접 검색해 주세요."
          : "장소 정보를 찾지 못했어요. 확인 화면에서 직접 검색해 주세요.",
        confirm_url: confirmUrl(sourceId),
        source_id: sourceId,
      };
    }

    // 장소가 하나이고 확실하면 바로 저장
    if (resolved.length === 1 && isConfident(resolved[0].c, resolved[0].places)) {
      const place = resolved[0].places[0];
      input.onProgress?.("save");
      const placeId = await savePlace({
        boardId: input.boardId,
        sourceId,
        extractionId: inserted?.[0]?.id ?? null,
        place,
        addedBy: input.who,
      });
      await setSourceStatus(sourceId, "done");
      return { status: "saved", message: `${place.name}을(를) 지도에 저장했어요.`, source_id: sourceId, place_url: `/?place=${placeId}` };
    }

    await setSourceStatus(sourceId, "pending_confirm");
    const n = resolved.length;
    return {
      status: "confirm",
      message: n > 1 ? `장소 ${n}곳을 찾았어요. 남길 곳을 골라 주세요.` : "어느 지점인지 골라 주세요.",
      confirm_url: confirmUrl(sourceId),
      source_id: sourceId,
    };
  } catch (e) {
    // 실패한 링크도 지도에서 다시 찾거나 직접 검색할 수 있어야 합니다.
    await setSourceStatus(sourceId, "needs_review");
    console.error("링크 처리 실패", { sourceId, message: e instanceof Error ? e.message : String(e) });
    return { status: "error", message: e instanceof Error ? e.message : "장소 저장에 실패했어요.", source_id: sourceId,
      confirm_url: confirmUrl(sourceId) };
  }
}

export interface Selection {
  extraction_id: string;
  include: boolean;
  place?: KakaoPlace | null;
}

/** 확인 화면에서 고른 결과 반영 (추리기 + 지점 선택) */
export async function confirmSelections(
  boardId: string,
  sourceId: string,
  who: string,
  selections: Selection[],
  direct?: KakaoPlace | null,
) {
  const { data: src, error: sourceError } = await db()
    .from("sources")
    .select("id")
    .eq("id", sourceId)
    .eq("board_id", boardId)
    .maybeSingle();
  checkDb(sourceError, "링크 조회 실패");
  if (!src) throw new Error("링크를 찾을 수 없습니다.");

  const { data: extractions, error: extractionError } = await db().from("extractions").select("id").eq("source_id", sourceId);
  checkDb(extractionError, "장소 후보 조회 실패");
  const allowed = new Set((extractions ?? []).map((e) => e.id));
  if (selections.some((s) => !allowed.has(s.extraction_id))) throw new Error("이 링크의 장소 후보가 아닙니다. 화면을 새로 열어 주세요.");

  let saved = 0;
  for (const s of selections) {
    const keep = s.include && !!s.place;
    const { error } = await db().from("extractions").update({ excluded: !keep }).eq("id", s.extraction_id).eq("source_id", sourceId);
    checkDb(error, "선택 내용 저장 실패");
    if (keep) {
      await savePlace({ boardId, sourceId, extractionId: s.extraction_id, place: s.place!, addedBy: who });
      saved++;
    }
  }
  // 추출 결과 없이 직접 검색해서 고른 장소
  if (direct) {
    await savePlace({ boardId, sourceId, extractionId: null, place: direct, addedBy: who });
    saved++;
  }
  await setSourceStatus(sourceId, "done");
  return saved;
}
