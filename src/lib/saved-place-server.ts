import { db } from "./db";
import type { Board } from "./auth";
import { boardRevision } from "./sync-server";
import type { SavedPlace } from "./saved-place";

/** Enrich a committed save without requiring another full-list request on arrival. */
export async function withSavedPlace<T extends { place_url?: string }>(board: Board, result: T): Promise<T & { saved_place?: SavedPlace }> {
  const id = new URL(result.place_url || "/", "https://datemap.local").searchParams.get("place");
  if (!id) return result;
  try {
    // Keep the earlier revision: a concurrent newer snapshot must win over this partial response.
    const revision = await boardRevision(board.id);
    const [place, links, saves] = await Promise.all([
      db().from("places").select("id, name, address, lat, lng, category, kakao_place_id, kakao_url, status, memo, created_at").eq("board_id", board.id).eq("id", id).maybeSingle(),
      db().from("source_places").select("added_by, sources!inner(id, url, media_type, board_id)").eq("place_id", id).eq("sources.board_id", board.id),
      db().from("place_saves").select("added_by, added_at").eq("board_id", board.id).eq("place_id", id),
    ]);
    if (place.error || links.error || saves.error || !place.data) return result;
    type Link = { added_by: string; sources: { id: string; url: string; media_type: string } };
    const sharers = new Set<string>(); const sources = new Map<string, { url: string; media_type: string }>();
    let latest = place.data.created_at;
    for (const link of (links.data ?? []) as unknown as Link[]) {
      sharers.add(link.added_by); sources.set(link.sources.id, { url: link.sources.url, media_type: link.sources.media_type });
    }
    for (const save of saves.data ?? []) { sharers.add(save.added_by); if (save.added_at > latest) latest = save.added_at; }
    return { ...result, saved_place: { boardId: board.id, authVersion: board.authVersion, revision,
      place: { ...place.data, kakao_place_id: place.data.kakao_place_id ?? null, sharers: [...sharers], sources: [...sources.values()], last_saved_at: latest } } };
  } catch {
    // The transaction already committed. A preview read failure must not turn it into a failed save.
    return result;
  }
}
