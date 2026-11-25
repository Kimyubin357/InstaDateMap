import type { FolderSummary } from "./folders";
import { paletteVar } from "./palette";
import type { PlaceView } from "./place-view";

/**
 * 방 고르기 · 전체 보기(2026-11-25 사용자 결정, 시안 design-lab/rooms-view).
 * 보는 범위는 "전체"(내가 들어간 모든 방) 또는 "방 하나"(이 기기가 연 방)이고, 지도와 리스트가 같이 씁니다.
 * 이 기기가 연 방(세션)은 전체에서 + 로 저장할 "마지막에 저장한 방"으로 남습니다.
 */
export type Scope = "all" | "room";
export interface RoomSummary extends FolderSummary {
  collection_count: number;
  /** 지금 멤버의 계정 id·이름(삭제 권한 판단: 처음 등록한 사람만, 그 사람이 방에 없으면 누구나) */
  member_ids: string[];
  member_names: string[];
  /** 멤버 프로필 사진(member_names와 같은 순서, 없으면 null). 방 카드·장소 리스트의 얼굴에 씁니다. */
  member_avatars?: (string | null)[];
}
export interface RoomsResponse { current: string | null; rooms: RoomSummary[] }
/** 전체 보기의 장소: 어느 방의 장소인지(board_id)를 함께 씁니다. */
export interface AllPlace extends PlaceView { board_id: string }
export interface AllPlacesResponse extends RoomsResponse { places: AllPlace[] }
/** 지도에 그릴 장소. 전체에서 여러 방에 있는 같은 가게는 핀 하나로 묶습니다(room_ids = 그 가게가 있는 방들). */
export interface MapPlace extends PlaceView { board_id?: string; room_ids?: string[]; group_ids?: string[] }

export const membersLabel = (count: number) => count > 1 ? `${count}명` : "나만";

/** 같은 가게: 카카오 장소 id가 같으면 같은 가게, 없으면 이름과 좌표(약 1m)가 같을 때. */
export function shopKey(place: Pick<PlaceView, "kakao_place_id" | "name" | "lat" | "lng">) {
  return place.kakao_place_id ? `k:${place.kakao_place_id}` : `n:${place.name}|${place.lat.toFixed(5)}|${place.lng.toFixed(5)}`;
}

/**
 * 전체 보기 지도: 여러 방에 있는 같은 가게를 핀 하나로 묶습니다.
 * 대표 장소는 이 기기가 연 방(current)의 것, 없으면 가장 최근에 저장한 방의 것입니다. 방 순서는 내 방 목록 순서를 따릅니다.
 */
export function groupByShop(places: readonly AllPlace[], roomOrder: readonly string[], current?: string | null): MapPlace[] {
  const order = new Map(roomOrder.map((id, i) => [id, i]));
  const groups = new Map<string, AllPlace[]>();
  for (const place of places) { const key = shopKey(place), list = groups.get(key) ?? []; list.push(place); groups.set(key, list); }
  return [...groups.values()].map((list) => {
    const recent = (p: AllPlace) => p.last_saved_at || p.created_at;
    const lead = list.find((p) => p.board_id === current) ?? [...list].sort((a, b) => recent(b).localeCompare(recent(a)))[0];
    const rooms = [...new Set(list.map((p) => p.board_id))].sort((a, b) => (order.get(a) ?? 99) - (order.get(b) ?? 99));
    return { ...lead, room_ids: rooms, group_ids: list.map((p) => p.id) };
  });
}

/** 지역 카드(전체)의 방 비율 막대: 방 id → 장소 수. 두 방에 있는 가게는 두 방 모두에 셉니다. */
export function roomShares(places: readonly MapPlace[], roomOrder: readonly string[]) {
  const counts = new Map<string, number>();
  for (const place of places) for (const room of place.room_ids ?? (place.board_id ? [place.board_id] : [])) counts.set(room, (counts.get(room) ?? 0) + 1);
  const order = new Map(roomOrder.map((id, i) => [id, i]));
  return [...counts.entries()].sort((a, b) => (order.get(a[0]) ?? 99) - (order.get(b[0]) ?? 99));
}

/** 색 여러 개를 같은 비율로 나눈 동그라미(전체 버튼·여러 방에 있는 핀 꼬리). 한 가지면 그 색 하나. */
export function splitColors(colors: readonly (string | null | undefined)[]) {
  if (!colors.length) return paletteVar(null);
  if (colors.length === 1) return paletteVar(colors[0]);
  const step = 100 / colors.length;
  return `conic-gradient(${colors.map((c, i) => `${paletteVar(c)} ${(i * step).toFixed(2)}% ${((i + 1) * step).toFixed(2)}%`).join(",")})`;
}

/** 새 장소 시트: 새 장소가 있는 방만, 내 방 목록 순서로. */
export function newPlacesByRoom<T extends Pick<AllPlace, "id" | "board_id" | "created_at">>(places: readonly T[], newIds: ReadonlySet<string>, rooms: readonly Pick<RoomSummary, "id">[]) {
  return rooms.map((room) => ({ room: room.id, places: places.filter((p) => p.board_id === room.id && newIds.has(p.id)).sort((a, b) => b.created_at.localeCompare(a.created_at)) }))
    .filter((entry) => entry.places.length > 0);
}

/** "방금", "12분 전", "2시간 전", "어제", "3일 전" */
export function timeAgo(iso: string, now = Date.now()) {
  const minutes = Math.floor((now - Date.parse(iso)) / 60000);
  if (!Number.isFinite(minutes) || minutes < 1) return "방금";
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "어제" : days < 7 ? `${days}일 전` : days < 30 ? `${Math.floor(days / 7)}주 전` : `${Math.floor(days / 30)}달 전`;
}

/** 이 기기에서 마지막으로 고른 범위. 처음에는 전체로 엽니다. */
const scopeKey = (userId: string) => `datemap-scope:${userId}`;
export function readScope(userId?: string | null): Scope {
  if (!userId) return "all";
  try { return localStorage.getItem(scopeKey(userId)) === "room" ? "room" : "all"; } catch { return "all"; }
}
export function writeScope(userId: string | null | undefined, scope: Scope) {
  if (!userId) return;
  try { localStorage.setItem(scopeKey(userId), scope); } catch { /* 저장소가 막힌 기기에서는 이번 화면에서만 기억합니다. */ }
}
