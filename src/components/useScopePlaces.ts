"use client";
import { useMemo } from "react";
import { useBoardState, useRooms } from "./BoardProvider";
import { groupByShop, type AllPlace, type MapPlace, type RoomSummary } from "@/lib/rooms";

const NONE: AllPlace[] = [];
/**
 * 지금 보는 범위의 장소(지도·리스트·검색이 같이 씁니다).
 * - 방 하나: 이 기기가 연 방(실시간 동기화되는 BoardStore).
 * - 전체: 모든 방(/api/places/all) + 연 방은 BoardStore의 최신 내용으로 바꿔 끼웁니다(방금 저장·수정이 바로 보이게).
 *   지도·리스트는 같은 가게를 하나로 묶은 `grouped`, 상세·새 장소는 방마다의 `flat`을 씁니다.
 */
export default function useScopePlaces() {
  const { snapshot } = useBoardState();
  const rooms = useRooms();
  const isAll = rooms.scope === "all";
  const openRoom = snapshot?.boardId ?? null;
  const roomPlaces = snapshot?.places;
  const flat = useMemo<AllPlace[]>(() => {
    const mine = (roomPlaces ?? NONE).map((p) => ({ ...p, board_id: openRoom ?? "" }));
    if (!isAll) return mine;
    const others = rooms.all ?? NONE;
    return roomPlaces ? [...mine, ...others.filter((p) => p.board_id !== openRoom)] : [...others];
  }, [isAll, roomPlaces, openRoom, rooms.all]);
  const order = useMemo(() => (rooms.rooms ?? []).map((r) => r.id), [rooms.rooms]);
  const grouped = useMemo<MapPlace[]>(() => isAll ? groupByShop(flat, order, openRoom) : flat, [isAll, flat, order, openRoom]);
  /** 방마다의 장소 id → 지도에 그린 대표 장소 id */
  const repOf = useMemo(() => {
    const map = new Map<string, string>();
    for (const g of grouped) for (const id of g.group_ids ?? [g.id]) map.set(id, g.id);
    return map;
  }, [grouped]);
  const roomById = useMemo(() => new Map<string, RoomSummary>((rooms.rooms ?? []).map((r) => [r.id, r])), [rooms.rooms]);
  /** 전체일 때 장소 목록이 준비됐는지(모든 방 목록을 받았거나, 받지 못했어도 연 방은 보여 줄 수 있을 때) */
  const loaded = isAll ? rooms.all !== null || (!!snapshot && !!rooms.allError) : !!snapshot;
  return { isAll, openRoom, flat, grouped, repOf, roomById, order, loaded, rooms };
}
