"use client";
import { useEffect, useState, type ReactNode } from "react";
import { toneStyle } from "./Palette";
import Icon from "./Icon";
import ShellLink from "./ShellLink";
import styles from "./EmptyStates.module.css";

/**
 * 빈 상태 · 로딩(2026-11-25, 시안 design-lab/empty-loading A안).
 * - 로딩은 덮개 없이 작게, 0.4초 안에 끝나면 아예 안 보입니다(깜빡임 방지).
 * - 빈 화면은 방 이름 + 할 일, 지도·탭·+ 를 막지 않습니다.
 * - 빈 방 리스트·빈 모음 탭은 같은 틀(아이콘 타일 + 제목 + 한 줄 + "이렇게 시작해 봐요" 줄).
 */

/** ms 뒤에야 true. 짧게 끝나는 로딩은 아무것도 띄우지 않으려고 씁니다. */
export function useDelayed(on: boolean, ms = 400) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!on) { setShown(false); return; }
    const timer = setTimeout(() => setShown(true), ms);
    return () => clearTimeout(timer);
  }, [on, ms]);
  return on && shown;
}

/** A1 지도 로딩: 검색줄 아래 작은 칩(덮개 없음) */
export function LoadingChip({ label }: { label: string }) {
  return <div className={styles.chip} role="status" aria-live="polite"><span className={styles.spin} aria-hidden="true" />{label}</div>;
}

/** A2 리스트 로딩: 실제 줄과 같은 크기의 뼈대 줄 */
export function SkeletonRows({ count = 6, label = "장소를 불러오는 중…" }: { count?: number; label?: string }) {
  return <div className={styles.skeleton} role="status" aria-busy="true"><span className="sr-only">{label}</span>
    {Array.from({ length: count }, (_, i) => <div key={i} className={styles.skRow} aria-hidden="true"><span className={styles.skDot} /><span className={styles.skLines}><i /><i /><i /></span></div>)}
  </div>;
}

/** 인스타 링크로 담는 두 단계(지도 안내 카드) */
export function AddSteps() {
  return <ol className={styles.steps}>
    <li><b>1</b><span>인스타 게시물에서 <span className={styles.ig}><Icon name="link" width={12} />Copy link</span></span></li>
    <li><b>2</b><span>오른쪽 아래 <span className={styles.plusMini}><Icon name="plus" width={13} strokeWidth={2.4} /></span> 누르고 붙여넣기</span></li>
  </ol>;
}

/** A3 빈 방 지도: 하단 탭 위 안내 카드(덮개 없음, + 버튼 열은 비워 둠) */
export function EmptyMapCard({ title, color, inviteHref, onRooms, onClose }: {
  title: string; color?: string | null; inviteHref?: string; onRooms?: () => void; onClose: () => void;
}) {
  return <section className={styles.mapCard} aria-labelledby="empty-map-title" style={color ? toneStyle(color) : undefined}>
    <button type="button" className={styles.close} aria-label="안내 닫기" onClick={onClose}><Icon name="close" width={18} /></button>
    <h2 id="empty-map-title">{color && <i className={styles.roomDot} aria-hidden="true" />}{title}</h2>
    <p>인스타에서 본 곳을 링크로 담아요.</p>
    <AddSteps />
    {(inviteHref || onRooms) && <div className={styles.links}>
      {inviteHref && <ShellLink href={inviteHref} className={styles.link}><Icon name="user" width={17} />친구 초대</ShellLink>}
      {onRooms && <button type="button" className={styles.link} onClick={onRooms}><Icon name="rooms" width={17} />다른 방 보기</button>}
    </div>}
  </section>;
}

export interface StartRow { icon: ReactNode; title: string; note: string; href?: string; onClick?: () => void; action?: "go" | "add"; label?: string }

/** A4·A6 공통: 아이콘 타일 + 제목 + 한 줄 설명, "이렇게 시작해 봐요" 아래 같은 모양 줄. 첫 줄(점선 타일)이 먼저 할 일. */
export function EmptyStart({ icon, title, note, rows }: { icon: ReactNode; title: string; note: string; rows: StartRow[] }) {
  return <section className={styles.start} aria-labelledby="empty-start-title">
    <div className={styles.head}><span className={styles.art} aria-hidden="true">{icon}</span><h2 id="empty-start-title">{title}</h2><p>{note}</p></div>
    <p className={styles.label}>이렇게 시작해 봐요</p>
    <div className={styles.rows}>{rows.map((r, i) => {
      const body = <><span className={`${styles.tile}${i === 0 ? ` ${styles.first}` : ""}`} aria-hidden="true">{r.icon}</span><span className={styles.copy}><strong>{r.title}</strong><small>{r.note}</small></span>
        {r.action === "add" ? <span className={styles.addCircle} aria-hidden="true"><i><Icon name="plus" width={15} strokeWidth={2.2} /></i></span> : <Icon name="chevron" width={18} />}</>;
      return r.href ? <ShellLink key={r.title} href={r.href} className={styles.row} aria-label={r.label}>{body}</ShellLink>
        : <button key={r.title} type="button" className={styles.row} aria-label={r.label} onClick={r.onClick}>{body}</button>;
    })}</div>
  </section>;
}
