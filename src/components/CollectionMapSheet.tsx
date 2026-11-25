"use client";
import { useRef, useState, type PointerEvent } from "react";
import Icon from "./Icon";
import PlaceRowBody from "./PlaceRowBody";
import { CollectionCover, RoomBand } from "./Palette";
import { usePlaceBriefs } from "./usePlaceBriefs";
import type { PlaceView } from "@/lib/place-view";
import styles from "./CollectionMapSheet.module.css";

export type SheetHeight = "low" | "mid" | "high";
const ORDER: SheetHeight[] = ["low", "mid", "high"];

/**
 * 모음 "지도에서 보기"(시안 design-lab/map-pins 4번, 2026-11-26): 지도 위에 모음 시트.
 * 머리 = 모음 표지 · 이름 · 방 · 장소 수 · X(모음으로 돌아가기), 안에는 리스트 줄(사진 · 영업 · 저장한 사람).
 * 높이는 접힘 · 중간 · 끝까지. 손잡이를 끌거나 눌러 바꿉니다. 지도는 시트 위로 계속 움직일 수 있습니다(덮개 없음).
 */
export default function CollectionMapSheet({ name, icon, roomName, roomColor, places, origin, faceOf, newPlaceIds, height, onHeight, onOpen, onClose }: {
  name: string; icon: string | null; roomName: string; roomColor?: string | null;
  places: PlaceView[]; origin?: { lat: number; lng: number } | null; faceOf: (name: string) => string | null | undefined;
  newPlaceIds?: ReadonlySet<string>; height: SheetHeight; onHeight: (height: SheetHeight) => void;
  onOpen: (id: string) => void; onClose: () => void;
}) {
  const briefOf = usePlaceBriefs(places.map((p) => p.kakao_place_id));
  const drag = useRef<{ id: number; y: number; moved: boolean } | null>(null);
  const [offset, setOffset] = useState(0);
  const step = (dir: 1 | -1) => onHeight(ORDER[Math.max(0, Math.min(2, ORDER.indexOf(height) + dir))]);
  function down(e: PointerEvent<HTMLDivElement>) { drag.current = { id: e.pointerId, y: e.clientY, moved: false }; e.currentTarget.setPointerCapture(e.pointerId); }
  function move(e: PointerEvent<HTMLDivElement>) {
    const d = drag.current; if (!d || d.id !== e.pointerId) return;
    const dy = e.clientY - d.y; if (Math.abs(dy) > 6) d.moved = true;
    setOffset(Math.max(-160, Math.min(160, dy)));
  }
  function up(e: PointerEvent<HTMLDivElement>) {
    const d = drag.current; if (!d || d.id !== e.pointerId) return;
    drag.current = null; setOffset(0);
    const dy = e.clientY - d.y;
    if (!d.moved) onHeight(height === "high" ? "mid" : height === "mid" ? "high" : "mid");
    else if (Math.abs(dy) > 40) step(dy < 0 ? 1 : -1);
  }
  return <section className={`collection-map-sheet ${styles.sheet} ${styles[height]}`} style={offset ? { translate: `0 ${offset}px`, transition: "none" } : undefined} aria-label={`${name} 모음 지도`}>
    <div className={styles.handle} role="button" tabIndex={0} aria-label={height === "high" ? "모음 목록 내리기" : "모음 목록 올리기"}
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => { drag.current = null; setOffset(0); }}
      onKeyDown={(e) => { if (e.key === "ArrowUp") { e.preventDefault(); step(1); } if (e.key === "ArrowDown") { e.preventDefault(); step(-1); } if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onHeight(height === "high" ? "mid" : "high"); } }}>
      <i aria-hidden="true" />
    </div>
    <header className={styles.head}>
      <CollectionCover icon={icon} size={44} />
      <span className={styles.copy}><strong>{name}</strong><small>{roomColor !== undefined && <RoomBand color={roomColor} shape="square" />}{roomName}의 모음 · 장소 {places.length}곳</small></span>
      <button type="button" className="icon-btn sheet-close-btn" aria-label="모음으로 돌아가기" onClick={onClose}><Icon name="close" width={18} /></button>
    </header>
    <div className={styles.list} inert={height === "low" || undefined}>
      {places.map((p) => <button key={p.id} type="button" className={`place-row ${styles.row}`} onClick={() => onOpen(p.id)}>
        <PlaceRowBody place={p} brief={briefOf(p.kakao_place_id)} origin={origin} faceOf={faceOf} isNew={newPlaceIds?.has(p.id)} />
      </button>)}
      {!places.length && <p className={styles.empty}>이 모음에는 아직 장소가 없어요.</p>}
    </div>
  </section>;
}
