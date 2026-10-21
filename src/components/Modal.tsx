"use client";
import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import Icon from "./Icon";
import { sheetStops, settleSheet, type SheetStop } from "@/lib/sheet";
export default function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLElement>(null); const close = useRef(onClose); close.current = onClose;
  const [height, setHeight] = useState<number>(); const [dragging, setDragging] = useState(false);
  const [viewport, setViewport] = useState<{ top: number; height: number }>();
  const stops = useRef(sheetStops(844)); const stop = useRef<SheetStop>(1); const mobile = useRef(false);
  const suppressClickUntil = useRef(0);
  const drag = useRef<{ id: number; startY: number; height: number; lastY: number; lastTime: number; velocity: number; moved: boolean }>();
  useEffect(() => {
    const resize = () => {
      mobile.current = window.matchMedia("(max-width:759px)").matches;
      const visibleHeight = window.visualViewport?.height || window.innerHeight;
      stops.current = sheetStops(visibleHeight);
      const layoutHeight = Math.max(window.innerHeight, document.documentElement.clientHeight);
      const top = Math.max(0, Math.min(window.visualViewport?.offsetTop || 0, layoutHeight - visibleHeight));
      setViewport((previous) => mobile.current ? previous?.top === top && previous.height === visibleHeight ? previous : { top, height: visibleHeight } : undefined);
      setHeight(mobile.current ? stops.current[stop.current] : undefined);
    };
    resize(); window.addEventListener("resize", resize); window.visualViewport?.addEventListener("resize", resize); window.visualViewport?.addEventListener("scroll", resize);
    return () => { window.removeEventListener("resize", resize); window.visualViewport?.removeEventListener("resize", resize); window.visualViewport?.removeEventListener("scroll", resize); };
  }, []);
  function revealInput() {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement) || !ref.current?.contains(active) || !active.matches("input, textarea, select")) return;
    const body = active.closest(".sheet-body"); if (!body) return;
    const field = active.getBoundingClientRect(), area = body.getBoundingClientRect();
    if (field.top < area.top || field.bottom > area.bottom) active.scrollIntoView({ block: "nearest" });
  }
  useEffect(() => { revealInput(); }, [viewport]);
  function snap(next: SheetStop) { stop.current = next; setHeight(stops.current[next]); }
  function start(e: PointerEvent<HTMLButtonElement>) {
    if (!mobile.current || !e.isPrimary || e.button !== 0) return;
    drag.current = { id: e.pointerId, startY: e.clientY, height: ref.current!.getBoundingClientRect().height, lastY: e.clientY, lastTime: e.timeStamp, velocity: 0, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function move(e: PointerEvent<HTMLButtonElement>) {
    const current = drag.current; if (!current || current.id !== e.pointerId) return;
    const delta = e.clientY - current.startY;
    if (Math.abs(delta) > 5) { current.moved = true; setDragging(true); }
    if (!current.moved) return;
    e.preventDefault();
    const elapsed = e.timeStamp - current.lastTime;
    if (elapsed > 0) current.velocity = (e.clientY - current.lastY) / elapsed;
    current.lastY = e.clientY; current.lastTime = e.timeStamp;
    setHeight(Math.max(32, Math.min(stops.current[2] + 20, current.height - delta)));
  }
  function finish(e: PointerEvent<HTMLButtonElement>, cancelled = false) {
    const current = drag.current; if (!current || current.id !== e.pointerId) return;
    drag.current = undefined; setDragging(false);
    if (!current.moved) return;
    suppressClickUntil.current = Date.now() + 300;
    const velocity = e.timeStamp - current.lastTime > 100 ? 0 : current.velocity;
    const target = cancelled ? stop.current : settleSheet(current.height - (e.clientY - current.startY), velocity, stops.current);
    if (target === null) { snap(stop.current); close.current(); }
    else snap(target);
  }
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLButtonElement>('[aria-label="닫기"]')?.focus({ preventScroll: true });
    const keyboard = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); close.current(); }
      if (e.key !== "Tab") return;
      const items = Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), summary, [tabindex="0"]') ?? []).filter((el) => el.getClientRects().length);
      if (!items.length) return;
      if (e.shiftKey && document.activeElement === items[0]) { e.preventDefault(); items[items.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === items[items.length - 1]) { e.preventDefault(); items[0].focus(); }
    };
    document.addEventListener("keydown", keyboard);
    return () => { document.removeEventListener("keydown", keyboard); if (previous?.isConnected) previous.focus(); };
  }, []);
  return <div className="modal-root" style={viewport ? { top: viewport.top, height: viewport.height, bottom: "auto" } : undefined}><div className="sheet-backdrop" onClick={onClose} /><section ref={ref} className={`sheet${dragging ? " is-dragging" : ""}`} style={height === undefined ? undefined : { height }} onTransitionEnd={revealInput} role="dialog" aria-modal="true" aria-label={title}>
    <button className="sheet-handle" type="button" aria-label="패널 크기 조절" onPointerDown={start} onPointerMove={move} onPointerUp={(e) => finish(e)} onPointerCancel={(e) => finish(e, true)} onLostPointerCapture={(e) => finish(e, true)}
      onClick={() => { if (Date.now() >= suppressClickUntil.current) snap(stop.current === 2 ? 0 : (stop.current + 1) as SheetStop); }}
      onKeyDown={(e) => { if (["ArrowUp", "ArrowDown", "Home", "End"].includes(e.key)) { e.preventDefault(); snap(e.key === "Home" ? 0 : e.key === "End" ? 2 : Math.max(0, Math.min(2, stop.current + (e.key === "ArrowUp" ? 1 : -1))) as SheetStop); } }}><span className="grabber" /><span className="sr-only">위아래로 드래그하거나 방향키로 크기를 바꿔요. 아래로 끝까지 내리면 닫혀요.</span></button>
    <div className="sheet-heading"><h2>{title}</h2><button className="icon-btn" aria-label="닫기" onClick={onClose}><Icon name="close" /></button></div><div className="sheet-body">{children}</div></section></div>;
}
