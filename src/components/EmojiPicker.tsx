"use client";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Icon from "./Icon";
import { Emoji } from "./Palette";
import { EMOJI_CATEGORIES, rememberEmoji, recentEmoji, searchEmoji } from "@/lib/emoji";
import { lastEmoji } from "@/lib/palette";
import styles from "./EmojiPicker.module.css";

/**
 * 모음 표지 이모지 고르기 시트(시안 6번). 모음 편집 시트 위에 뜨므로 네이티브 dialog로 띄워
 * 아래 시트의 키보드 처리와 겹치지 않게 합니다(Modal은 열린 data-app-dialog가 있으면 손을 뗍니다).
 * 위 칸에 낱말로 찾거나 키보드의 이모지를 넣고, 누르면 바로 골라지고 닫힙니다. 하나만 남깁니다.
 */
export default function EmojiPicker({ value, suggestions = [], onPick, onClose }: {
  value: string; suggestions?: string[]; onPick: (emoji: string) => void; onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState(() => EMOJI_CATEGORIES.find((c) => c.items.some(([e]) => e === value))?.key ?? EMOJI_CATEGORIES[0].key);
  const [recent] = useState(() => [...new Set([...recentEmoji(), ...suggestions])].slice(0, 7));
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog || document.querySelector(".app-recovery")) return;
    dialog.showModal();
    requestAnimationFrame(() => dialog.querySelector<HTMLButtonElement>("[aria-pressed=true][data-emoji]")?.focus({ preventScroll: true }));
    return () => { if (dialog.open) dialog.close(); };
  }, []);
  const typed = lastEmoji(query);
  const results = useMemo(() => typed ? [typed] : searchEmoji(query), [typed, query]);
  const searching = query.trim().length > 0;
  const shown = searching ? results : EMOJI_CATEGORIES.find((c) => c.key === category)!.items.map(([e]) => e);
  function pick(emoji: string) { rememberEmoji(emoji); onPick(emoji); }
  function onInput(next: string) {
    // 키보드에서 이모지를 넣으면 그 하나만 남깁니다.
    const emoji = lastEmoji(next);
    setQuery(emoji ?? next);
  }
  const cell = (emoji: string) => <button key={emoji} type="button" data-emoji className={styles.cell} aria-pressed={emoji === value} aria-label={`${emoji} 고르기`} onClick={() => pick(emoji)}><Emoji value={emoji} /></button>;
  if (typeof document === "undefined") return null;
  return createPortal(<dialog ref={ref} data-app-dialog className={styles.sheet} aria-labelledby={`${id}-title`} aria-describedby={`${id}-lead`}
    onCancel={(e) => { e.preventDefault(); e.stopPropagation(); onClose(); }}
    onClick={(e) => { if (e.target === e.currentTarget) { const box = e.currentTarget.getBoundingClientRect(); if (e.clientY < box.top || e.clientX < box.left || e.clientX > box.right) onClose(); } }}>
    <span className={styles.handle} aria-hidden="true"><i /></span>
    <div className={styles.head}>
      <div><h2 id={`${id}-title`}>이모지 고르기</h2><p id={`${id}-lead`}>모음 표지에 하나만 들어가요.</p></div>
      <button type="button" className="icon-btn sheet-close-btn" aria-label="이모지 고르기 닫기" onClick={onClose}><Icon name="close" width={18} /></button>
    </div>
    <div className={styles.body}>
      <label className={styles.field}>
        <Icon name="search" width={20} />
        <input ref={input} value={query} onChange={(e) => onInput(e.target.value)} placeholder="이모지 찾기 · 예: 커피, 바다" aria-label="이모지 찾기" enterKeyHint="done" maxLength={40}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (results.length === 1) pick(results[0]); } }} />
        {query
          ? <button type="button" className={styles.kb} aria-label="찾기 지우기" onClick={() => { setQuery(""); input.current?.focus(); }}><Icon name="close" width={18} /></button>
          : <button type="button" className={styles.kb} aria-label="키보드로 이모지 넣기" onClick={() => input.current?.focus()}><Emoji value="🌐" /></button>}
      </label>
      {searching ? <>
        <p className={styles.label} role="status">{typed ? "넣은 이모지" : results.length ? `찾은 이모지 ${results.length}개` : "찾은 이모지가 없어요. 키보드의 이모지를 넣어도 돼요."}</p>
        {results.length > 0 && <div className={styles.grid}>{shown.map(cell)}</div>}
      </> : <>
        {recent.length > 0 && <><p className={styles.label}>최근</p><div className={styles.recent}>{recent.map(cell)}</div></>}
        <div className={styles.cats} role="group" aria-label="이모지 묶음">
          {EMOJI_CATEGORIES.map((c) => <button key={c.key} type="button" aria-pressed={category === c.key} onClick={() => setCategory(c.key)}>{c.label}</button>)}
        </div>
        <div className={styles.grid}>{shown.map(cell)}</div>
      </>}
    </div>
  </dialog>, document.body);
}
