"use client";
import { useEffect, useState } from "react";
import Icon from "./Icon";
import { friendlyMessage, requestJson } from "@/lib/client-request";
import type { PlaceDetails } from "@/lib/place-details";
import styles from "./PlaceExtras.module.css";

/** 같은 장소를 다시 열면 바로 보여줍니다(서버도 7일 캐시). */
const memory = new Map<string, PlaceDetails>();

/**
 * 장소 상세의 가게 정보: 사진(가게 등록 사진 우선 최대 5장), 전화, 영업시간, 메뉴, 네이버 지도·예약, 캐치테이블(입점 확인된 곳만).
 * 지도·리스트 상세가 함께 쓰며, 접힘·중간 높이 측정 영역 밖(펼친 본문)에 둡니다.
 */
export default function PlaceExtras({ placeId }: { placeId: string }) {
  const [details, setDetails] = useState<PlaceDetails | null>(() => memory.get(placeId) ?? null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (memory.has(placeId)) { setDetails(memory.get(placeId)!); return; }
    const abort = new AbortController();
    setDetails(null); setError("");
    requestJson<PlaceDetails>(`/api/places/${placeId}/details`, { signal: abort.signal, notifyBoardChange: false, timeoutMs: 25000 })
      .then((d) => { if (d.status !== "error") memory.set(placeId, d); setDetails(d); })
      .catch((e) => { if (!abort.signal.aborted) setError(friendlyMessage(e, "가게 정보를 불러오지 못했어요.")); });
    return () => abort.abort();
  }, [placeId, attempt]);

  if (error || details?.status === "error" && !details.phone) return <section className={styles.extras} aria-label="가게 정보">
    <p className={styles.hint}>{error || "가게 정보를 지금 불러오지 못했어요."}</p>
    <button type="button" className={`text-btn ${styles.retry}`} onClick={() => { memory.delete(placeId); setAttempt((n) => n + 1); }}>다시 불러오기</button>
  </section>;
  if (!details) return <section className={styles.extras} aria-label="가게 정보" aria-busy="true"><p className={styles.hint} role="status">가게 정보를 불러오는 중…</p></section>;
  const { photos, phone, hours, menus, naver_url, booking_url, catchtable_url } = details;
  const nothing = !photos.length && !phone && !hours && !menus.length && !naver_url;
  if (nothing) return <section className={styles.extras} aria-label="가게 정보"><p className={styles.hint}>네이버에서 이 가게의 사진·메뉴를 찾지 못했어요.</p></section>;
  return <section className={styles.extras} aria-label="가게 정보">
    {photos.length > 0 && <div className={styles.photos} role="list" aria-label={`가게 사진 ${photos.length}장`}>
      {photos.map((p, i) => <a key={p.url} role="listitem" href={naver_url ?? p.url} target="_blank" rel="noreferrer" aria-label={`가게 사진 ${i + 1} 네이버에서 보기`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={p.url} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" width={p.width ?? undefined} height={p.height ?? undefined} />
      </a>)}
    </div>}
    <div className={styles.rows}>
      {phone && <a className={styles.row} href={`tel:${phone.replace(/-/g, "")}`}><Icon name="phone" width="20" /><span><strong>{phone}</strong><small>전화 걸기</small></span><Icon name="chevron" width="16" /></a>}
      {hours && <details className={styles.hours}>
        <summary className={styles.row}><Icon name="clock" width="20" /><span><strong>{[hours.status, hours.description].filter(Boolean).join(" · ") || "영업시간"}</strong><small>{hours.days.length ? "요일별 시간 보기" : "네이버 기준"}</small></span>{hours.days.length > 0 && <Icon name="chevron" width="16" />}</summary>
        {hours.days.length > 0 && <ul>{hours.days.map((d, i) => <li key={`${d.day}-${i}`}><b>{d.day}</b><span>{d.open && d.close ? `${d.open}~${d.close}` : d.note ?? "휴무"}{d.breaks.length ? ` · 쉬는 시간 ${d.breaks.join(", ")}` : ""}</span></li>)}</ul>}
      </details>}
    </div>
    {menus.length > 0 && <div className={styles.menus}><span className="section-label">메뉴</span>
      <ul>{menus.map((m, i) => <li key={`${m.name}-${i}`}><span>{m.name}</span>{m.price && <b>{m.price}</b>}</li>)}</ul>
    </div>}
    {(naver_url || booking_url || catchtable_url) && <div className={styles.links}>
      {catchtable_url && <a className={`btn ${styles.catchtable}`} href={catchtable_url} target="_blank" rel="noreferrer">캐치테이블 예약<Icon name="external" width="16" /></a>}
      {booking_url && <a className={`btn ${styles.booking}`} href={booking_url} target="_blank" rel="noreferrer">네이버 예약<Icon name="external" width="16" /></a>}
      {naver_url && <a className="btn" href={naver_url} target="_blank" rel="noreferrer">네이버 지도<Icon name="external" width="16" /></a>}
    </div>}
    {(photos.length > 0 || menus.length > 0) && <p className={styles.source}>사진·메뉴·영업시간: 네이버 플레이스</p>}
  </section>;
}
