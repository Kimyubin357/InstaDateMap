import { placePeople, type Member, type SaveRecord } from "./people";

/** 장소 행 + 원본 연결 + 저장 기록 → 지도·리스트가 쓰는 장소(저장한 사람·처음 등록한 사람은 지금 이름, 019). */
export type PlaceRow = { id: string; created_at: string; kakao_place_id?: string | null };
export type PlaceLink = SaveRecord & { place_id: string; sources: { id: string; url: string; media_type: string } };
export type PlaceSave = SaveRecord & { place_id: string; added_at: string };

/**
 * 한 방(/api/places)과 여러 방(/api/places/all)이 같은 규칙으로 장소를 만듭니다.
 * `membersOf`: 그 장소가 있는 방의 지금 멤버(계정 id → 지금 이름).
 */
export function shapePlaces<T extends PlaceRow>(places: readonly T[], links: readonly PlaceLink[], saves: readonly PlaceSave[], membersOf: (place: T) => readonly Member[]) {
  const byPlace = new Map<string, { records: SaveRecord[]; sources: Map<string, { url: string; media_type: string }> }>();
  const entry = (id: string) => { const e = byPlace.get(id) ?? { records: [] as SaveRecord[], sources: new Map<string, { url: string; media_type: string }>() }; byPlace.set(id, e); return e; };
  for (const l of links) {
    const e = entry(l.place_id);
    e.records.push(l);
    e.sources.set(l.sources.id, { url: l.sources.url, media_type: l.sources.media_type });
  }
  const latest = new Map<string, string>();
  for (const s of saves) {
    entry(s.place_id).records.push(s);
    if (!latest.has(s.place_id) || s.added_at > latest.get(s.place_id)!) latest.set(s.place_id, s.added_at);
  }
  return places.map((p) => {
    const e = byPlace.get(p.id);
    return {
      ...p,
      kakao_place_id: p.kakao_place_id ?? null,
      ...placePeople(e?.records ?? [], membersOf(p)),
      sources: e ? [...e.sources.values()] : [],
      last_saved_at: latest.get(p.id) || p.created_at,
    };
  });
}
