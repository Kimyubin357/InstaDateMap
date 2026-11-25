"use client";
import type { ReactNode } from "react";
import Icon from "./Icon";
import CategoryGlyph, { categoryTone } from "./CategoryGlyph";
import { distanceM, placeMeta, type PlaceView } from "@/lib/place-view";
import { distanceLabel, openState, type PlaceBrief } from "@/lib/place-brief";
import styles from "./PlaceRowBody.module.css";

/**
 * 장소 리스트 한 줄(시안 design-lab/place-list B안, 2026-11-26):
 * 가게 사진(없으면 분류 아이콘 타일) | 이름 · 거리 / 분류 · 지역 / 영업 상태 · 영업시간 · (얼굴) [이름]님이 저장.
 * 색 띠·› 없음. 정보가 없으면 그 부분만 뺍니다.
 */
export default function PlaceRowBody({ place, brief, origin, faceOf, isNew, extra, lead }: {
  place: PlaceView; brief: PlaceBrief | null; origin?: { lat: number; lng: number } | null;
  /** 저장한 사람 이름 → 프로필 사진 주소 */
  faceOf: (name: string) => string | null | undefined;
  isNew?: boolean; extra?: ReactNode;
  /** 선택 모드의 체크처럼 사진 자리를 대신할 것 */
  lead?: ReactNode;
}) {
  const tone = categoryTone(place.category, place.name);
  const open = openState(brief?.hours ?? null);
  const savers = place.sharers.slice(0, 2);
  const saver = place.sharers.length >= 2 ? `${place.sharers.length}명이 저장` : place.sharers[0] ? `${place.sharers[0]}님이 저장` : "";
  return <>
    {lead ?? <span className={styles.thumbWrap} aria-hidden="true">
      {brief?.photo
        // eslint-disable-next-line @next/next/no-img-element
        ? <img className={styles.thumb} src={brief.photo} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" />
        : <span className={`${styles.thumb} ${styles.noPhoto} category-${tone}`}><CategoryGlyph category={place.category} name={place.name} size={36} /></span>}
    </span>}
    <span className={`row-copy ${styles.copy}`}>
      <span className={styles.title}><strong>{place.name}{isNew && <> <span className="new-place-badge">NEW</span></>}</strong>{origin && <span className={styles.km}>{distanceLabel(distanceM(origin, place))}</span>}</span>
      <span className={styles.meta}>{placeMeta(place) || place.address}</span>
      {extra}
      {(open || saver) && <span className={styles.line3}>
        {open && <span className={styles.hours}><b className={styles[open.tone]}>{open.label}</b>{open.time && <span>{open.time}</span>}</span>}
        {saver && <span className={styles.who}>
          <span className={styles.faces} aria-hidden="true">{savers.map((n, i) => {
            const src = faceOf(n);
            // eslint-disable-next-line @next/next/no-img-element
            return src ? <img key={`${n}-${i}`} src={src} alt="" referrerPolicy="no-referrer" decoding="async" /> : <i key={`${n}-${i}`}><Icon name="user" width={10} height={10} /></i>;
          })}</span>{saver}</span>}
      </span>}
    </span>
  </>;
}
