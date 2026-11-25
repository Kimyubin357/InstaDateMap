"use client";
import { useEffect, useRef, useState } from "react";
import Icon from "./Icon";
import Modal from "./Modal";
import ShellLink from "./ShellLink";
import { toneStyle } from "./Palette";
import { categoryIcon } from "@/lib/place-presentation";
import { placeMeta, type PlaceView } from "@/lib/place-view";
import { membersLabel, splitColors, timeAgo, type RoomSummary, type Scope } from "@/lib/rooms";
import styles from "./Rooms.module.css";

/** 방 고르기 · 전체 보기(2026-11-25, 시안 design-lab/rooms-view 1~10번) */
export const NEW_ROOM_HREF = "/folders?new=1";

/** 방 버튼·전체 카드의 색: 전체 = 방 색을 나눈 동그라미/네모, 방 안 = 그 방 색 */
export function RoomDot({ colors, shape = "dot", className = "" }: { colors: readonly (string | null | undefined)[]; shape?: "dot" | "square" | "all"; className?: string }) {
  return <i className={`${shape === "dot" ? styles.dot : shape === "all" ? styles.allSquare : styles.square}${className ? ` ${className}` : ""}`} style={{ background: splitColors(colors) }} aria-hidden="true" />;
}

/** 필터 버튼 자리의 동그란 방 바꾸기 버튼(네 칸 아이콘 = 방 카드 2열, 2026-11-25 사용자 결정). 지금 어느 방인지는 검색칸("[방 이름]에서 검색")과 방 머리띠가 보여 줍니다. */
export function RoomScopeButton({ name, open, onClick }: { name: string; open: boolean; onClick: () => void }) {
  return <button type="button" className={`icon-btn bordered search-filter-btn room-scope-btn${open ? " is-open" : ""}`} aria-haspopup="dialog" aria-expanded={open} aria-label={`보는 방: ${name}. 방 바꾸기`} onClick={onClick}>
    <Icon name="rooms" width={21} />
  </button>;
}

const roomMeta = (r: RoomSummary) => `장소 ${r.place_count}곳 · ${r.collection_count ? `모음 ${r.collection_count}개` : "모음 없음"}`;

/** 멤버 이름 첫 글자 동그라미(최대 3개) + "2명"/"나만" */
export function MemberFaces({ names, count }: { names: readonly string[]; count: number }) {
  return <span className={styles.who}><span className={styles.faces} aria-hidden="true">{names.slice(0, 3).map((n, i) => <i key={`${n}-${i}`}>{Array.from(n.trim())[0] ?? "?"}</i>)}</span>{membersLabel(count)}</span>;
}

/** 그 방 설정(이름·색·멤버·초대)으로 바로 가는 주소 */
export const roomSettingsHref = (id: string) => `/folders?room=${encodeURIComponent(id)}`;

/**
 * 방 색 카드 2열. withAll: 맨 앞 전체 카드(내 방 시트). 지금 보는 카드에 초록 테두리 + 체크.
 * 방 카드마다 오른쪽 위 ⚙ 로 그 방 설정을 바로 엽니다(방·모음 구분 A안, 2026-11-25). 카드와 ⚙ 는 서로 다른 버튼입니다(겹친 버튼 없음).
 */
export function RoomCards({ rooms, selected, withAll, compact, disabled, onPick }: {
  rooms: readonly RoomSummary[]; selected?: "all" | string | null; withAll?: boolean; compact?: boolean; disabled?: boolean; onPick: (target: "all" | string) => void;
}) {
  const total = rooms.reduce((sum, r) => sum + r.place_count, 0);
  const check = <span className={styles.check} aria-hidden="true"><Icon name="check" width={15} strokeWidth={2.6} /></span>;
  return <div className={`${styles.grid}${compact ? ` ${styles.compact}` : ""}`} role={withAll ? "radiogroup" : undefined} aria-label={withAll ? "보는 방" : "내 방"}>
    {withAll && <button type="button" role="radio" aria-checked={selected === "all"} disabled={disabled} className={`${styles.card} ${styles.allCard}${selected === "all" ? ` ${styles.on}` : ""}`} onClick={() => onPick("all")}>
      <RoomDot colors={rooms.map((r) => r.color)} shape="all" /><strong>전체</strong><small>방 {rooms.length}개 · 장소 {total}곳</small>{selected === "all" && check}
    </button>}
    {rooms.map((r) => <div key={r.id} className={styles.cell}>
      <button type="button" role={withAll ? "radio" : undefined} aria-checked={withAll ? selected === r.id : undefined} disabled={disabled}
        aria-label={`${r.name}, ${roomMeta(r)}, ${membersLabel(r.member_count)}${withAll ? "" : ". 이 방으로 들어가기"}`}
        className={`${styles.card} ${styles.roomCard}${selected === r.id ? ` ${styles.on}` : ""}`} style={toneStyle(r.color)} onClick={() => onPick(r.id)}>
        <strong>{r.name}</strong><small>{roomMeta(r)}</small><MemberFaces names={r.member_names} count={r.member_count} />{selected === r.id && check}
      </button>
      <ShellLink href={roomSettingsHref(r.id)} className={styles.gear} aria-label={`${r.name} 방 설정`} aria-disabled={disabled} onClick={(e) => { if (disabled) e.preventDefault(); }}><i><Icon name="settings" width={17} /></i></ShellLink>
    </div>)}
    <ShellLink href={NEW_ROOM_HREF} className={`${styles.card} ${styles.addCard}`} aria-disabled={disabled}><Icon name="plus" width={26} />새 방 만들기</ShellLink>
  </div>;
}

/** 방 안 리스트 맨 위 방 머리띠: 지금 어느 방인지(방 색 · 이름 · 멤버 · 장소 수) + ⚙ 방 설정(방·모음 구분 A안) */
export function RoomHeader({ room, fallbackName }: { room?: RoomSummary; fallbackName: string }) {
  const name = room?.name ?? fallbackName;
  return <div className={styles.band} style={toneStyle(room?.color)}>
    <span className={styles.bandCopy}><strong>{name}</strong>{room && <small>방 · {membersLabel(room.member_count)} · 장소 {room.place_count}곳</small>}</span>
    {room && <ShellLink href={roomSettingsHref(room.id)} className={styles.gear} aria-label={`${name} 방 설정`}><i><Icon name="settings" width={18} /></i></ShellLink>}
  </div>;
}

/** "내 방" 시트(시안 3번): 전체 + 방 카드 + 새 방 만들기. 고르면 닫히고 지도·리스트가 그 범위로 바뀝니다. */
export function RoomsSheet({ rooms, scope, current, error, onPick, onClose }: {
  rooms: RoomSummary[] | null; scope: Scope; current: string | null; error: string; onPick: (target: "all" | string) => Promise<void>; onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const close = <button className="icon-btn sheet-close-btn" aria-label="내 방 닫기" disabled={busy} onClick={onClose}><Icon name="close" width={18} /></button>;
  return <Modal title="내 방" variant="compact" className={styles.sheet} headerActions={close} onClose={() => { if (!busy) onClose(); }}>
    {!rooms && !error && <p className={styles.status} role="status">방 목록을 불러오고 있어요…</p>}
    {rooms && <RoomCards rooms={rooms} compact withAll disabled={busy} selected={scope === "all" ? "all" : current}
      onPick={(target) => { if (busy) return; setBusy(true); void onPick(target).finally(() => setBusy(false)); }} />}
    {busy && <p className={styles.status} role="status">방을 바꾸는 중…</p>}
    {error && <p className={styles.error} role="alert">{error}</p>}
  </Modal>;
}

/** 방 꼬리표: 방 색 점 + 방 이름. 두 방에 있는 가게는 꼬리표 두 개. */
export function RoomTags({ rooms }: { rooms: readonly Pick<RoomSummary, "id" | "name" | "color">[] }) {
  return <span className={styles.tags}>{rooms.map((r) => <span key={r.id} className={styles.tag} style={toneStyle(r.color)}><i /><span>{r.name}</span></span>)}</span>;
}

/** 장소 상세: 이 장소가 있는 방(전체 보기에서만) */
export function PlaceRoomsLine({ rooms }: { rooms: readonly Pick<RoomSummary, "id" | "name" | "color">[] }) {
  return <p className={styles.placeRooms}><span>있는 방</span><RoomTags rooms={rooms} /></p>;
}

export interface NewRoomEntry { room: RoomSummary; places: PlaceView[] }
/**
 * 새 장소 시트(시안 9·10번). 새 장소가 있는 방 → 그 방의 새 장소(누가·언제).
 * 장소를 누르면 지도에서 그 장소로 가고(그 장소의 NEW가 사라짐), [모두 본 걸로 하기]는 이 방의 NEW를 한 번에 지웁니다.
 * 방 하나만 보고 있으면 바로 그 방의 새 장소를 보여 줍니다.
 */
export function NewPlacesSheet({ entries, scope, onPlace, onAllSeen, onRoomMap, onClose }: {
  entries: NewRoomEntry[]; scope: Scope; onPlace: (place: PlaceView) => void; onAllSeen: (entry: NewRoomEntry) => void; onRoomMap: (entry: NewRoomEntry) => void; onClose: () => void;
}) {
  const single = scope === "room" || entries.length === 1;
  const [roomId, setRoomId] = useState<string | null>(single ? entries[0]?.room.id ?? null : null);
  const entry = entries.find((e) => e.room.id === roomId) ?? (single ? entries[0] : undefined);
  // 모두 본 걸로 한 방은 목록에서 빠집니다. 남은 방이 없으면 닫습니다.
  const closed = useRef(false);
  useEffect(() => {
    if (!entries.length) { if (!closed.current) { closed.current = true; onClose(); } }
    else if (roomId && !entries.some((e) => e.room.id === roomId) && !single) setRoomId(null);
  }, [entries, roomId, single, onClose]);
  const close = <button className="icon-btn sheet-close-btn" aria-label="새 장소 닫기" onClick={onClose}><Icon name="close" width={18} /></button>;
  const now = Date.now();
  if (!entry) return <Modal title="새 장소" variant="compact" className={styles.sheet} headerActions={close} onClose={onClose}>
    <p className={styles.lead}>아직 안 본 장소예요. 보면 사라지고, 안 봐도 24시간 뒤에 사라져요.</p>
    <div>{entries.map((e) => <button type="button" key={e.room.id} className={styles.roomRow} aria-label={`${e.room.name} 새 장소 ${e.places.length}곳 보기`} onClick={() => setRoomId(e.room.id)}>
      <span className={styles.roomSquare} style={toneStyle(e.room.color)} aria-hidden="true" />
      <span className={styles.rowCopy}><strong>{e.room.name}</strong><small>{membersLabel(e.room.member_count)} · 장소 {e.room.place_count}</small></span>
      <span className={styles.count} aria-hidden="true">새 {e.places.length}</span>
      <Icon name="chevron" width={18} className={styles.chev} />
    </button>)}</div>
  </Modal>;
  const title = `${entry.room.name} · 새 장소 ${entry.places.length}`;
  return <Modal title={title} variant="compact" className={styles.sheet} headerActions={close} onClose={onClose}
    footer={<><button type="button" className="btn" onClick={() => onAllSeen(entry)}>모두 본 걸로 하기</button><button type="button" className="btn primary" onClick={() => onRoomMap(entry)}>{scope === "all" ? "이 방 지도에서 보기" : "지도에서 보기"}</button></>}>
    {!single && <button type="button" className={`text-btn ${styles.backLink}`} onClick={() => setRoomId(null)}><Icon name="back" width={18} />새 장소가 있는 방</button>}
    <p className={styles.lead}>누르면 그 장소로 가고, NEW가 사라져요.</p>
    <div>{entry.places.map((p) => <button type="button" key={p.id} className={styles.placeRow} onClick={() => onPlace(p)}>
      <span className={`category-icon category-${categoryIcon(p.category)}`} aria-hidden="true"><Icon name={categoryIcon(p.category)} width={22} /></span>
      <span className={styles.rowCopy}><strong><span>{p.name}</span><span className="new-place-badge" aria-label="새로 등록한 장소">NEW</span></strong>
        <small>{placeMeta(p) || p.address}</small><small>{[p.registrant || p.sharers[0], timeAgo(p.created_at, now)].filter(Boolean).join(" · ")}</small></span>
      <Icon name="chevron" width={18} className={styles.chev} />
    </button>)}</div>
  </Modal>;
}
