import { db } from "./db";
import type { Board } from "./auth";
import { boardRevision } from "./sync-server";
import type { SavedPlace } from "./saved-place";
import { placePeople, type SaveRecord } from "./people";

/** Enrich a committed save without requiring another full-list request on arrival. */
export async function withSavedPlace<T extends { place_url?: string }>(board: Board, result: T): Promise<T & { saved_place?: SavedPlace }> {
  const id = new URL(result.place_url || "/", "https://datemap.local").searchParams.get("place");
  if (!id) return result;
  try {
    // Keep the earlier revision: a concurrent newer snapshot must win over this partial response.
    const revision = await boardRevision(board.id);
    const [place, links, saves] = await Promise.all([
      db().from("places").select("id, name, address, lat, lng, category, kakao_place_id, kakao_url, status, memo, memo_version, created_at").is("deleted_at", null).eq("board_id", board.id).eq("id", id).maybeSingle(),
      db().from("source_places").select("added_by, added_by_user_id, added_at, sources!inner(id, url, media_type, board_id)").eq("place_id", id).eq("sources.board_id", board.id),
      db().from("place_saves").select("added_by, added_by_user_id, added_at").eq("board_id", board.id).eq("place_id", id),
    ]);
    if (place.error || links.error || saves.error || !place.data) return result;
    type Link = SaveRecord & { sources: { id: string; url: string; media_type: string } };
    const sources = new Map<string, { url: string; media_type: string }>();
    let latest = place.data.created_at;
    for (const link of (links.data ?? []) as unknown as Link[]) sources.set(link.sources.id, { url: link.sources.url, media_type: link.sources.media_type });
    for (const save of saves.data ?? []) if (save.added_at > latest) latest = save.added_at;
    // 저장한 사람·처음 등록한 사람은 지도 목록(GET /api/places)과 같은 규칙으로 지금 이름을 씁니다(019).
    const people = placePeople([...((links.data ?? []) as unknown as Link[]), ...((saves.data ?? []) as SaveRecord[])], board.members);
    return { ...result, saved_place: { boardId: board.id, authVersion: board.authVersion, revision,
      place: { ...place.data, kakao_place_id: place.data.kakao_place_id ?? null, ...people, sources: [...sources.values()], last_saved_at: latest } } };
  } catch {
    // The transaction already committed. A preview read failure must not turn it into a failed save.
    return result;
  }
}
