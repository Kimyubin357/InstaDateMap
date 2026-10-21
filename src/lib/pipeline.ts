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
  token: string;
  text: string; // 공유 시트에서 넘어온 텍스트(링크 포함)
  who: string;
  caption?: string | null;
  images?: SourceContext["images"];
}

/** 단축어가 읽는 응답. message는 알림으로 그대로 보여 줍니다. */
export interface ShareResponse {
  status: "saved" | "confirm" | "needs_caption" | "needs_review" | "duplicate" | "error";
  message: string;
  confirm_url?: string;
  source_id?: string;
}

const MAX_PLACES_PER_SOURCE = 8;

export function confirmUrl(sourceId: string, token: string, who: string) {
  return `${env.baseUrl()}/confirm/${sourceId}?t=${encodeURIComponent(token)}&who=${encodeURIComponent(who)}`;
}

export function firstUrl(text: string): string | null {
  const m = text.match(/https?:\/\/[^\s"'<>]+/);
  return m ? m[0] : null;
}

/** 장소를 지도에 저장. 같은 카카오 장소면 새로 만들지 않고 공유 기록만 추가합니다. */
export async function savePlace(args: {
  boardId: string;
  sourceId: string;
  extractionId: string | null;
  place: KakaoPlace;
  addedBy: string;
}) {
  const { boardId, sourceId, extractionId, place, addedBy } = args;
  const { data: row, error } = await db()
    .from("places")
    .upsert(
      {
        board_id: boardId,
        kakao_place_id: place.kakao_place_id,
        name: place.name,
        address: place.address,
        lat: place.lat,
        lng: place.lng,
        category: place.category,
        kakao_url: place.kakao_url,
      },
      { onConflict: "board_id,kakao_place_id" },
    )
    .select("id")
    .single();
  if (error || !row) throw new Error(`장소 저장 실패: ${error?.message}`);
  await db()
    .from("source_places")
    .upsert(
      { source_id: sourceId, place_id: row.id, extraction_id: extractionId, added_by: addedBy },
      { onConflict: "source_id,place_id,added_by", ignoreDuplicates: true },
    );
  return row.id as string;
}

export async function ingestShare(input: ShareInput, llm: LlmCall = callLlm): Promise<ShareResponse> {
  const raw = firstUrl(input.text) ?? input.text;
  const url = normalizeInstagramUrl(raw);
  if (!url) return { status: "error", message: "인스타그램 게시물이나 릴스 링크가 아닙니다." };

  const manualCaption = input.caption?.trim() || null;
  const images = input.images ?? [];

  // 이미 처리한 링크인지 확인
  const { data: existing } = await db()
    .from("sources")
    .select("id, status")
    .eq("board_id", input.boardId)
    .eq("url", url)
    .maybeSingle();

  const retrying = !!manualCaption || images.length > 0;
  if (existing && !retrying) {
    if (existing.status === "done") {
      // 연인이 이미 공유한 링크면 "둘 다 저장함"이 되도록 내 공유 기록도 남깁니다.
      const { data: links } = await db()
        .from("source_places")
        .select("place_id, extraction_id")
        .eq("source_id", existing.id);
      if (links?.length) {
        await db()
          .from("source_places")
          .upsert(
            links.map((l) => ({ ...l, source_id: existing.id, added_by: input.who })),
            { onConflict: "source_id,place_id,added_by", ignoreDuplicates: true },
          );
      }
      return { status: "duplicate", message: "이미 지도에 있는 링크예요.", source_id: existing.id };
    }
    if (existing.status === "pending_confirm" || existing.status === "needs_review" || existing.status === "needs_caption") {
      return {
        status: "confirm",
        message: "확인이 남아 있는 링크예요.",
        confirm_url: confirmUrl(existing.id, input.token, input.who),
        source_id: existing.id,
      };
    }
  }

  // 캡션 확보
  let caption = manualCaption;
  let method: "og" | "oembed" | "manual" | null = manualCaption ? "manual" : null;
  let locationTag: string | null = null;
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
    shared_by: input.who,
  };

  if (!caption && !locationTag && images.length === 0) {
    const { data } = await db()
      .from("sources")
      .upsert({ ...sourceRow, status: "needs_caption" }, { onConflict: "board_id,url" })
      .select("id")
      .single();
    return {
      status: "needs_caption",
      message: "캡션을 가져오지 못했어요. 열리는 화면에 캡션을 붙여넣어 주세요.",
      confirm_url: data?.id ? confirmUrl(data.id, input.token, input.who) : undefined,
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

  // 다시 처리하는 경우 이전 추출 결과를 지웁니다.
  await db().from("extractions").delete().eq("source_id", sourceId);

  const ctx: SourceContext = {
    url,
    mediaType: sourceRow.media_type,
    caption,
    locationTag,
    images,
    videos: [],
  };
  const { candidates } = await extractPlaces(ctx, { llm });
  const top = candidates.slice(0, MAX_PLACES_PER_SOURCE);

  const resolved = await Promise.all(
    top.map(async (c) => ({ c, places: await resolveCandidate(c).catch(() => [] as KakaoPlace[]) })),
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
  const { data: inserted } = rows.length
    ? await db().from("extractions").insert(rows).select("id")
    : { data: [] as { id: string }[] };

  const withPlaces = resolved.filter((r) => r.places.length > 0);

  if (withPlaces.length === 0) {
    await db().from("sources").update({ status: "needs_review" }).eq("id", sourceId);
    return {
      status: "needs_review",
      message: top.length
        ? "장소 이름은 찾았지만 지도에서 못 찾았어요. 확인 화면에서 직접 검색해 주세요."
        : "장소 정보를 찾지 못했어요. 확인 화면에서 직접 검색해 주세요.",
      confirm_url: confirmUrl(sourceId, input.token, input.who),
      source_id: sourceId,
    };
  }

  // 장소가 하나이고 확실하면 바로 저장
  if (resolved.length === 1 && isConfident(resolved[0].c, resolved[0].places)) {
    const place = resolved[0].places[0];
    await savePlace({
      boardId: input.boardId,
      sourceId,
      extractionId: inserted?.[0]?.id ?? null,
      place,
      addedBy: input.who,
    });
    await db().from("sources").update({ status: "done" }).eq("id", sourceId);
    return { status: "saved", message: `${place.name}을(를) 지도에 저장했어요.`, source_id: sourceId };
  }

  await db().from("sources").update({ status: "pending_confirm" }).eq("id", sourceId);
  const n = resolved.length;
  return {
    status: "confirm",
    message: n > 1 ? `장소 ${n}곳을 찾았어요. 남길 곳을 골라 주세요.` : "어느 지점인지 골라 주세요.",
    confirm_url: confirmUrl(sourceId, input.token, input.who),
    source_id: sourceId,
  };
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
  const { data: src } = await db()
    .from("sources")
    .select("id")
    .eq("id", sourceId)
    .eq("board_id", boardId)
    .maybeSingle();
  if (!src) throw new Error("링크를 찾을 수 없습니다.");

  let saved = 0;
  for (const s of selections) {
    const keep = s.include && !!s.place;
    await db().from("extractions").update({ excluded: !keep }).eq("id", s.extraction_id).eq("source_id", sourceId);
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
  await db().from("sources").update({ status: "done" }).eq("id", sourceId);
  return saved;
}
