"use client";
import type { ComponentProps, ReactNode } from "react";
import Icon from "./Icon";
import Modal from "./Modal";
import ShellLink from "./ShellLink";
import { toneStyle } from "./Palette";
import styles from "./ActionSheet.module.css";

type IconName = ComponentProps<typeof Icon>["name"];
export interface ActionItem {
  icon: IconName; title: string; note?: string;
  /** 다른 화면으로 가면 href, 이 자리에서 하면 onSelect */
  href?: string; onSelect?: () => void;
  /** 지우기·나가기처럼 되돌리기 어려운 일: 빨강, 맨 아래 */
  danger?: boolean;
  /** 오른쪽 › 표시(기본: 빨강이 아니면 표시) */
  chevron?: boolean;
  /** › 앞에 붙는 것(멤버 얼굴 등) */
  side?: ReactNode;
}

/**
 * 동작 시트(시안 design-lab/edit-sheets, 2026-11-26): 모음 "편집"·방 ⚙·멤버 ⋯ 를 누르면 아래에서 올라와 할 일을 고릅니다.
 * 머리 = 표지(lead) · 이름 · 한 줄 설명 · X, 줄 = 아이콘 · 이름 · 설명 · ›. 빨강 줄은 맨 아래에 둡니다.
 */
export default function ActionSheet({ title, note, lead, items, onClose }: { title: string; note?: string; lead?: ReactNode; items: ActionItem[]; onClose: () => void }) {
  return <Modal title={title} variant="compact" className={styles.sheet} onClose={onClose}>
    <div className={styles.head}>
      {lead}
      <span className={styles.copy}><strong>{title}</strong>{note && <small>{note}</small>}</span>
      <button type="button" className="icon-btn sheet-close-btn" aria-label={`${title} 닫기`} onClick={onClose}><Icon name="close" width={18} /></button>
    </div>
    <ul className={styles.list}>{items.map((item) => {
      const inner = <>
        <Icon name={item.icon} width={22} className={styles.icon} />
        <span className={styles.text}>{item.title}{item.note && <small>{item.note}</small>}</span>
        {item.side}
        {(item.chevron ?? !item.danger) && <Icon name="chevron" width={18} className={styles.chevron} />}
      </>;
      const className = `${styles.row}${item.danger ? ` ${styles.danger}` : ""}`;
      return <li key={item.title}>{item.href
        ? <ShellLink href={item.href} className={className} onClick={onClose}>{inner}</ShellLink>
        : <button type="button" className={className} onClick={item.onSelect}>{inner}</button>}</li>;
    })}</ul>
  </Modal>;
}

/** 동작 시트 머리의 표지: 방 색 타일(tone) · 사람 얼굴(round, 사진 또는 첫 글자). 모음은 CollectionCover를 그대로 씁니다. */
export function ActionLead({ children, tone, round, photo }: { children?: ReactNode; tone?: string | null; round?: boolean; photo?: string | null }) {
  return <span className={`${styles.lead}${tone !== undefined ? ` ${styles.toned}` : ""}${round ? ` ${styles.round}` : ""}`} style={tone !== undefined ? toneStyle(tone) : undefined} aria-hidden="true">
    {/* eslint-disable-next-line @next/next/no-img-element */}
    {photo ? <img src={photo} alt="" referrerPolicy="no-referrer" decoding="async" /> : children}
  </span>;
}
