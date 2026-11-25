"use client";
import { useRef, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import Icon from "./Icon";
import { PALETTE_COLORS, PALETTE_LABEL, collectionEmoji, paletteVar, type PaletteColor } from "@/lib/palette";
import styles from "./Palette.module.css";

/** 방·모음 색 하나를 CSS 변수(--tone)로 넘깁니다. */
export const toneStyle = (color?: string | null) => ({ "--tone": paletteVar(color) } as CSSProperties);

/** 방 표시: 목록·시트의 왼쪽 색 띠(row) 또는 작은 색 네모(square). 방에는 아이콘이 없습니다. */
export function RoomBand({ color, shape = "row", className = "" }: { color?: string | null; shape?: "row" | "square"; className?: string }) {
  return <span className={`${styles.band}${shape === "square" ? ` ${styles.square}` : ""}${className ? ` ${className}` : ""}`} style={toneStyle(color)} aria-hidden="true" />;
}

/** 방 만들기·설정 맨 위의 색 카드(이름·색을 고르는 대로 바로 바뀜) */
export function RoomCard({ color, kicker, name, meta, placeholder = "방 이름" }: { color: string; kicker: string; name: string; meta: string; placeholder?: string }) {
  return <div className={styles.roomCard} style={toneStyle(color)} aria-hidden="true">
    <span className={styles.kicker}>{kicker}</span>
    <span className={`${styles.roomName}${name ? "" : ` ${styles.placeholder}`}`}>{name || placeholder}</span>
    <span className={styles.meta}><Icon name="user" width={16} />{meta}</span>
  </div>;
}

/** 모음 표지: 모음 색 위 이모지 하나 */
export function CollectionCover({ color, icon, size = 44, className = "" }: { color?: string | null; icon?: string | null; size?: number; className?: string }) {
  return <span className={`${styles.cover}${size >= 96 ? ` ${styles.coverBig}` : ""}${className ? ` ${className}` : ""}`} style={{ ...toneStyle(color), "--size": `${size}px` } as CSSProperties} aria-hidden="true"><i className={styles.emoji}>{collectionEmoji(icon)}</i></span>;
}

/** 이모지 글자만(색 바탕 없이) */
export function Emoji({ value, className = "" }: { value?: string | null; className?: string }) {
  return <i className={`${styles.emoji}${className ? ` ${className}` : ""}`} aria-hidden="true">{collectionEmoji(value)}</i>;
}

/** 색 10칸. 색만 있고 고른 칸에만 체크가 붙습니다(미리 골라 두거나 쓰는 중인지 표시하지 않음). */
export function ColorSwatches({ value, onChange, disabled = false, label = "색" }: { value: PaletteColor; onChange: (color: PaletteColor) => void; disabled?: boolean; label?: string }) {
  const group = useRef<HTMLDivElement>(null);
  function move(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    const step = { ArrowRight: 1, ArrowDown: 5, ArrowLeft: -1, ArrowUp: -5 }[e.key];
    if (!step) return;
    e.preventDefault();
    const next = PALETTE_COLORS[(index + step + PALETTE_COLORS.length) % PALETTE_COLORS.length];
    onChange(next);
    requestAnimationFrame(() => group.current?.querySelector<HTMLButtonElement>(`[data-color="${next}"]`)?.focus());
  }
  return <div ref={group} className={styles.swatches} role="radiogroup" aria-label={label}>
    {PALETTE_COLORS.map((color, index) => <button key={color} type="button" role="radio" data-color={color} aria-checked={value === color} aria-label={PALETTE_LABEL[color]}
      tabIndex={value === color ? 0 : -1} disabled={disabled} style={toneStyle(color)} onClick={() => onChange(color)} onKeyDown={(e) => move(e, index)}>
      {value === color && <Icon name="check" width={20} strokeWidth={2.6} />}
    </button>)}
  </div>;
}

/** 폼의 작은 제목 줄(왼쪽 이름, 오른쪽 보조) */
export function FieldLabel({ htmlFor, children, aside }: { htmlFor?: string; children: string; aside?: ReactNode }) {
  return <div className={styles.fieldLabel}>{htmlFor ? <label htmlFor={htmlFor}>{children}</label> : <span>{children}</span>}{aside}</div>;
}

export { styles as paletteStyles };
