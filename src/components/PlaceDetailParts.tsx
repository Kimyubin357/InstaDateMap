"use client";
import { useEffect, useState } from "react";
import Icon from "./Icon";
import { friendlyMessage, requestJson } from "@/lib/client-request";
import type { PlaceDetails } from "@/lib/place-details";
import { openState } from "@/lib/place-brief";
import styles from "./PlaceDetailParts.module.css";

/**
 * 장소 상세의 가게 정보(시안 design-lab/place-detail, 2026-11-26): 네이버 가게 정보를 한 번 받아
 * 영업 칩 · 사진 · 정보 줄(영업시간·주소·전화) · 메뉴 · 예약으로 나눠 그립니다. 같은 장소를 다시 열면 바로 보여 줍니다(서버도 7일 캐시).
 */
const memory = new Map<string, PlaceDetails>();

/** room: 전체 보기에서 다른 방의 장소면 그 방(서버가 멤버인지 확인합니다). */
export function usePlaceDetails(placeId: string, room?: string) {
  const [details, setDetails] = useState<PlaceDetails | null>(() => memory.get(placeId) ?? null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (memory.has(placeId)) { setDetails(memory.get(placeId)!); return; }
    const abort = new AbortController();
    setDetails(null); setError("");
    requestJson<PlaceDetails>(`/api/places/${placeId}/details${room ? `?room=${encodeURIComponent(room)}` : ""}`, { signal: abort.signal, notifyBoardChange: false, timeoutMs: 25000 })
      .then((d) => { if (d.status !== "error") memory.set(placeId, d); setDetails(d); })
      .catch((e) => { if (!abort.signal.aborted) setError(friendlyMessage(e, "가게 정보를 불러오지 못했어요.")); });
    return () => abort.abort();
  }, [placeId, room, attempt]);
  const failed = !!error || (details?.status === "error" && !details.phone);
  return { details: failed ? null : details, loading: !details && !error, error: failed ? error || "가게 정보를 지금 불러오지 못했어요." : "", retry: () => { memory.delete(placeId); setAttempt((n) => n + 1); } };
}

/** 이름 아래 영업 칩: "영업 전 · 11:30~21:00" */
export function OpenChip({ details }: { details: PlaceDetails | null }) {
  const open = openState(details?.hours ?? null);
  if (!open) return null;
  return <span className={`${styles.chip} ${styles[open.tone]}`}>{open.label}{open.time && ` · ${open.time}`}</span>;
}

/** 사진 넘기기(최대 5장). 누르면 네이버에서 크게 봅니다. 사진이 없으면 아무것도 그리지 않습니다. */
export function PlacePhotos({ details, loading }: { details: PlaceDetails | null; loading: boolean }) {
  if (loading) return <div className={styles.photos} aria-hidden="true"><span className={styles.photoSkeleton} /><span className={`${styles.photoSkeleton} ${styles.small}`} /></div>;
  const photos = details?.photos ?? [];
  if (!photos.length) return null;
  return <div className={styles.photos} role="list" aria-label={`가게 사진 ${photos.length}장`}>
    {photos.map((p, i) => <a key={p.url} role="listitem" href={details?.naver_url ?? p.url} target="_blank" rel="noreferrer" aria-label={`가게 사진 ${i + 1} 네이버에서 보기`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={p.url} alt="" loading={i ? "lazy" : "eager"} decoding="async" referrerPolicy="no-referrer" />
    </a>)}
  </div>;
}

/** 정보 줄: 영업시간(펼치면 요일별) · 주소(복사) · 전화(걸기). 아이콘 + 글 + 오른쪽 동작 하나. */
export function PlaceInfo({ details, address, onCopyAddress, error, onRetry }: { details: PlaceDetails | null; address: string | null; onCopyAddress: () => void; error?: string; onRetry?: () => void }) {
  const hours = details?.hours ?? null, open = openState(hours);
  return <section className={styles.rows} aria-label="가게 정보">
    {hours && <details className={styles.hours}>
      <summary className={styles.row}><Icon name="clock" width="20" /><span className={styles.text}>{open ? <><b className={styles[open.tone]}>{open.label}</b>{hours.description ? ` · ${hours.description}` : open.time ? ` · ${open.time}` : ""}</> : hours.status || "영업시간"}</span>{hours.days.length > 0 && <span className={styles.side}><Icon name="down" width="18" /></span>}</summary>
      {hours.days.length > 0 && <ul>{hours.days.map((d, i) => <li key={`${d.day}-${i}`}><b>{d.day}</b><span>{d.open && d.close ? `${d.open}~${d.close}` : d.note ?? "휴무"}{d.breaks.length ? ` · 쉬는 시간 ${d.breaks.join(", ")}` : ""}</span></li>)}</ul>}
    </details>}
    {address && <button type="button" className={styles.row} onClick={onCopyAddress} aria-label={`주소 복사: ${address}`}><Icon name="pin" width="20" /><span className={styles.text}>{address}</span><span className={styles.side}><Icon name="copy" width="18" /></span></button>}
    {details?.phone && <a className={styles.row} href={`tel:${details.phone.replace(/-/g, "")}`}><Icon name="phone" width="20" /><span className={styles.text}>{details.phone}</span><span className={styles.link}>전화</span></a>}
    {error && <div className={styles.row}><Icon name="clock" width="20" /><span className={styles.text}><span className={styles.muted}>{error}</span></span>{onRetry && <button type="button" className={`text-btn ${styles.link}`} onClick={onRetry}>다시</button>}</div>}
  </section>;
}

/** 메뉴: 3개 + 더보기 */
export function PlaceMenus({ details }: { details: PlaceDetails | null }) {
  const [all, setAll] = useState(false);
  const menus = details?.menus ?? [];
  if (!menus.length) return null;
  return <section className={styles.menus} aria-label="메뉴">
    <div className={styles.row}><Icon name="food" width="20" /><span className={styles.text}>메뉴 <small>{menus.length}</small></span></div>
    <ul>{(all ? menus : menus.slice(0, 3)).map((m, i) => <li key={`${m.name}-${i}`}><span>{m.name}</span>{m.price && <b>{m.price}</b>}</li>)}</ul>
    {menus.length > 3 && <button type="button" className={styles.more} onClick={() => setAll(!all)}>{all ? "접기" : "더보기"}<Icon name="down" width="14" style={all ? { rotate: "180deg" } : undefined} /></button>}
  </section>;
}

/** 예약: 네이버 예약 · 캐치테이블(있을 때만) */
export function PlaceBooking({ details }: { details: PlaceDetails | null }) {
  if (!details?.booking_url && !details?.catchtable_url) return null;
  return <section className={styles.rows} aria-label="예약">
    {details.booking_url && <a className={styles.row} href={details.booking_url} target="_blank" rel="noreferrer"><Icon name="clock" width="20" /><span className={styles.text}>네이버 예약</span><span className={styles.side}><Icon name="external" width="18" /></span></a>}
    {details.catchtable_url && <a className={styles.row} href={details.catchtable_url} target="_blank" rel="noreferrer"><Icon name="food" width="20" /><span className={styles.text}>캐치테이블</span><span className={styles.side}><Icon name="external" width="18" /></span></a>}
  </section>;
}
