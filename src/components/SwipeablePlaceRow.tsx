"use client";
import { useEffect, useId, useRef, useState, type PointerEvent, type ReactNode } from "react";
import Icon from "./Icon";
import styles from "./SwipeablePlaceRow.module.css";

const REVEAL_WIDTH = 88;
type Gesture = { id: number; x: number; y: number; start: number; offset: number; axis: "pending" | "horizontal" | "vertical" };

/** Swiping reveals an explicit action; even a full swipe never deletes a place. */
export default function SwipeablePlaceRow({ placeId, name, className, children, open, onReveal, onOpen, onDelete }: {
  placeId: string; name: string; className: string; children: ReactNode; open: boolean;
  onReveal: (open: boolean) => void; onOpen: () => void; onDelete: () => void;
}) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null), row = useRef<HTMLButtonElement>(null), action = useRef<HTMLButtonElement>(null);
  const gesture = useRef<Gesture | null>(null), suppressClickUntil = useRef(0);
  const [dragging, setDragging] = useState(false);
  const reveal = useRef(onReveal); reveal.current = onReveal;

  function paint(offset: number) { root.current?.style.setProperty("--swipe-offset", `${offset}px`); }
  useEffect(() => {
    gesture.current = null; setDragging(false); paint(open ? -REVEAL_WIDTH : 0);
    if (!open) return;
    const outside = (event: globalThis.PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) reveal.current(false);
    };
    const scroll = () => reveal.current(false);
    document.addEventListener("pointerdown", outside, true);
    window.addEventListener("scroll", scroll, true);
    return () => { document.removeEventListener("pointerdown", outside, true); window.removeEventListener("scroll", scroll, true); };
  }, [open]);

  function start(event: PointerEvent<HTMLButtonElement>) {
    if (!event.isPrimary || event.button !== 0) return;
    suppressClickUntil.current = 0;
    gesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY, start: open ? -REVEAL_WIDTH : 0, offset: open ? -REVEAL_WIDTH : 0, axis: "pending" };
  }
  function move(event: PointerEvent<HTMLButtonElement>) {
    const g = gesture.current;
    if (!g || g.id !== event.pointerId || g.axis === "vertical") return;
    const dx = event.clientX - g.x, dy = event.clientY - g.y;
    if (g.axis === "pending") {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 10) return;
      if (Math.abs(dx) <= Math.abs(dy) * 1.3) { g.axis = "vertical"; return; }
      g.axis = "horizontal";
      event.currentTarget.setPointerCapture(event.pointerId);
      setDragging(true);
    }
    event.preventDefault();
    g.offset = Math.max(-REVEAL_WIDTH, Math.min(0, g.start + dx));
    paint(g.offset);
  }
  function finish(event: PointerEvent<HTMLButtonElement>, cancelled = false) {
    const g = gesture.current;
    if (!g || g.id !== event.pointerId) return;
    gesture.current = null; setDragging(false);
    if (g.axis !== "pending" || cancelled) suppressClickUntil.current = performance.now() + 500;
    const next = cancelled ? open : g.axis === "horizontal" ? g.offset < -REVEAL_WIDTH * .45 : open;
    paint(next ? -REVEAL_WIDTH : 0); onReveal(next);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  function revealForKeyboard() {
    onReveal(true);
    requestAnimationFrame(() => action.current?.focus({ preventScroll: true }));
  }
  function closeAndFocus() { onReveal(false); row.current?.focus({ preventScroll: true }); }

  return <div ref={root} className={`${styles.swipe}${dragging ? ` ${styles.dragging}` : ""}`} data-swipe-row data-place-id={placeId} data-swipe-open={open}
    onKeyDown={(event) => {
      if (open && (event.key === "Escape" || event.key === "ArrowRight")) { event.preventDefault(); event.stopPropagation(); closeAndFocus(); }
    }}>
    <button ref={row} type="button" className={`${className} ${styles.surface}`} aria-describedby={`${id}-hint`}
      onPointerDown={start} onPointerMove={move} onPointerUp={(event) => finish(event)} onPointerCancel={(event) => finish(event, true)}
      onLostPointerCapture={(event) => { if (event.target === event.currentTarget && gesture.current) finish(event, true); }}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft" || event.key === "Delete") { event.preventDefault(); revealForKeyboard(); }
      }}
      onClick={(event) => {
        if (performance.now() < suppressClickUntil.current) { event.preventDefault(); suppressClickUntil.current = 0; return; }
        if (open) onReveal(false); else onOpen();
      }}>{children}</button>
    <span id={`${id}-hint`} className="sr-only">왼쪽으로 밀거나 Delete 키를 눌러 삭제 버튼을 표시할 수 있어요.</span>
    <button type="button" className={styles.reveal} aria-label={`${name} 삭제 옵션`} aria-expanded={open} aria-controls={`${id}-delete`} hidden={open} onClick={revealForKeyboard}>
      <Icon name="trash" width={18} /><span>삭제 옵션</span>
    </button>
    <button ref={action} id={`${id}-delete`} type="button" className={styles.action} aria-label={`${name} 삭제`} tabIndex={open ? 0 : -1} aria-hidden={!open} disabled={!open} onClick={onDelete}>
      <Icon name="trash" width={22} /><span>삭제</span>
    </button>
  </div>;
}
