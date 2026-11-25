"use client";
import type { ReactNode } from "react";
import Icon from "./Icon";
import PlaceRowBody from "./PlaceRowBody";
import { usePlaceBriefs } from "./usePlaceBriefs";
import { RoomCards, RoomTags } from "./Rooms";
import type { MapPlace, RoomSummary } from "@/lib/rooms";
import styles from "./CollectionsList.module.css";

/**
 * 리스트 · 전체(시안 5·6번): [전체 장소 | 방].
 * 전체 장소 = 모든 방의 장소(같은 가게는 한 줄, 방 꼬리표 둘), 방 = 방 색 카드(누르면 그 방으로 들어감) + 새 방 만들기.
 * 여러 개 선택·밀어서 삭제·모음 정리는 방 안 리스트에서 합니다.
 */
export default function AllPlacesList({ mode, places, total, rooms, roomsError, loaded, tools, newPlaceIds, distanceOrigin, onNavigate, onOpen, onEnterRoom, onReset }: {
  mode: "all" | "rooms"; places: MapPlace[]; total: number; rooms: RoomSummary[] | null; roomsError: string; loaded: boolean; tools: ReactNode;
  newPlaceIds: ReadonlySet<string>; distanceOrigin?: { lat: number; lng: number } | null;
  onNavigate: (mode: "all" | "rooms") => void; onOpen: (id: string) => void; onEnterRoom: (id: string) => void; onReset: () => void;
}) {
  const byId = new Map((rooms ?? []).map((r) => [r.id, r]));
  // 저장한 사람 얼굴: 모든 방 멤버 이름 → 프로필 사진
  const faces = new Map((rooms ?? []).flatMap((r) => r.member_names.map((n, i) => [n, r.member_avatars?.[i] ?? null] as const)).filter(([, a]) => a));
  const faceOf = (name: string) => faces.get(name);
  const briefOf = usePlaceBriefs(mode === "all" ? places.map((p) => p.kakao_place_id) : []);
  const roomsOf = (p: MapPlace) => (p.room_ids ?? (p.board_id ? [p.board_id] : [])).map((id) => byId.get(id)).filter((r): r is RoomSummary => !!r);
  return <section className={styles.workspace} aria-label="모든 방의 장소와 방">
    <div className={styles.switch} aria-label="리스트 보기 방식">
      <button aria-pressed={mode === "all"} onClick={() => onNavigate("all")}>전체 장소 <span className="switch-count">{total}</span></button>
      <button aria-pressed={mode === "rooms"} onClick={() => onNavigate("rooms")}>방 <span className="switch-count">{rooms?.length ?? 0}</span></button>
    </div>
    <div className={styles.content}>
    {mode === "rooms" ? <>
      <div className="rooms-label"><span>방 {rooms?.length ?? 0}개</span><span>10개까지</span></div>
      {!rooms && !roomsError && <p className="search-hint" role="status">방 목록을 불러오고 있어요…</p>}
      {roomsError && !rooms && <p className="error" role="alert">{roomsError}</p>}
      {rooms && <RoomCards rooms={rooms} onPick={(id) => { if (id !== "all") onEnterRoom(id); }} />}
      <p className="rooms-quiet"><Icon name="list" width={18} /><span>방을 누르면 그 방으로 들어가요. 지도도 그 방 장소만 보여 주고, 리스트는 <b>장소 | 모음</b>으로 바뀌어요.</span></p>
    </> : <>
      <div className={styles.filters}>{tools}</div>
      {places.map((p) => <button type="button" key={p.id} data-place-id={p.id} className={`place-row ${styles.row}`} onClick={() => onOpen(p.id)}>
        <PlaceRowBody place={p} brief={briefOf(p.kakao_place_id)} origin={distanceOrigin} faceOf={faceOf} isNew={newPlaceIds.has(p.id)}
          extra={<span className="all-row-rooms"><RoomTags rooms={roomsOf(p)} /></span>} />
      </button>)}
      {loaded && !places.length && <div className={styles.empty}><Icon name={total ? "search" : "pin"} width={32} /><h3>{total ? "조건에 맞는 장소가 없어요" : "첫 장소를 담아 봐요"}</h3><p>{total ? "다른 종류를 골라 보세요." : "모든 방의 장소를 여기에서 함께 볼 수 있어요."}</p>{total > 0 && <button className="text-btn" onClick={onReset}>모든 종류 보기</button>}</div>}
    </>}
    </div>
  </section>;
}
