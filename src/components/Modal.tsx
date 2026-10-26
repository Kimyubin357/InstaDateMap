"use client";
import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import Icon from "./Icon";
import { contentPullDecision, sheetStops, settleSheet, type SheetStop } from "@/lib/sheet";
import { layoutViewportHeight, visibleViewport } from "@/lib/viewport";
export default function Modal({ title, children, onClose, variant = "resizable", footer, headerActions, summary, fullScreenAtMax = !!summary, resizeMedia = "(max-width:759px), (max-height:600px) and (orientation:landscape)", className = "", initialStop = 1, dragFromContent = false, dialogRole = "dialog" }: { title: string; children: ReactNode; onClose: () => void; variant?: "resizable" | "compact"; footer?: ReactNode; headerActions?: ReactNode; summary?: ReactNode; fullScreenAtMax?: boolean; resizeMedia?: string; className?: string; initialStop?: SheetStop; dragFromContent?: boolean; dialogRole?: "dialog" | "alertdialog" }) {
  const ref = useRef<HTMLElement>(null); const close = useRef(onClose); close.current = onClose;
  const body = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number>(); const [dragging, setDragging] = useState(false);
  const [viewport, setViewport] = useState<{ top: number; height: number }>();
  const stops = useRef(sheetStops(844)); const stop = useRef<SheetStop>(initialStop); const mobile = useRef(false);
  const summaryRef = useRef<HTMLDivElement>(null);
  const footerRef = useRef<HTMLDivElement>(null);
  const suppressClickUntil = useRef(0);
  const drag = useRef<{ id: number; source: "handle" | "content"; stop: SheetStop; startY: number; height: number; lastY: number; lastTime: number; velocity: number; moved: boolean } | undefined>(undefined);
  useEffect(() => {
    const resize = () => {
      mobile.current = window.matchMedia(resizeMedia).matches;
      const layoutHeight = layoutViewportHeight();
      const editable = !!document.activeElement?.matches("input,textarea,[contenteditable=true]");
      const { top, height } = visibleViewport(layoutHeight, window.visualViewport?.height || window.innerHeight, window.visualViewport?.offsetTop || 0, editable);
      const content = summaryRef.current && footerRef.current && ref.current;
      const preview = body.current?.querySelector<HTMLElement>("[data-sheet-preview]");
      const style = content ? getComputedStyle(ref.current!) : undefined;
      stops.current = sheetStops(height, content ? {
        collapsed: Math.max(44, summaryRef.current!.getBoundingClientRect().height) + parseFloat(style!.getPropertyValue("--sheet-summary-space")) + parseFloat(style!.getPropertyValue("--sheet-handle-height")) + footerRef.current!.getBoundingClientRect().height + 1,
        preview: (preview?.getBoundingClientRect().height || 0) + 16,
      } : undefined);
      if (fullScreenAtMax) stops.current[2] = height;
      setViewport((previous) => mobile.current ? previous?.top === top && previous.height === height ? previous : { top, height } : undefined);
      setHeight(mobile.current && variant === "resizable" ? stops.current[stop.current] : undefined);
    };
    const observer = new ResizeObserver(resize);
    for (const element of [summaryRef.current, footerRef.current, body.current?.querySelector("[data-sheet-preview]")]) if (element) observer.observe(element, { box: "border-box" });
    resize(); window.addEventListener("resize", resize); window.addEventListener("pageshow", resize); window.visualViewport?.addEventListener("resize", resize); window.visualViewport?.addEventListener("scroll", resize);
    return () => { observer.disconnect(); window.removeEventListener("resize", resize); window.removeEventListener("pageshow", resize); window.visualViewport?.removeEventListener("resize", resize); window.visualViewport?.removeEventListener("scroll", resize); };
  }, [variant, !!summary, fullScreenAtMax, resizeMedia]);
  function revealInput() {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement) || !ref.current?.contains(active) || !active.matches("input, textarea, select")) return;
    const body = active.closest(".sheet-body"); if (!body) return;
    const field = active.getBoundingClientRect(), area = body.getBoundingClientRect();
    if (field.top < area.top || field.bottom > area.bottom) active.scrollIntoView({ block: "nearest" });
  }
  useEffect(() => { revealInput(); }, [viewport]);
  function snap(next: SheetStop) {
    const active = document.activeElement;
    stop.current = next; setHeight(stops.current[next]);
    if (fullScreenAtMax && mobile.current) {
      if (next === 0 && active instanceof HTMLElement && body.current?.contains(active)) active.blur();
      if (next === 0 || active?.classList.contains("sheet-back-btn") || active?.classList.contains("sheet-handle")) {
        requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>(next === 2 ? ".sheet-back-btn" : ".sheet-handle")?.focus({ preventScroll: true }));
      }
    }
    if (next < 2 && body.current) body.current.scrollTop = 0;
  }
  function beginDrag(id: number, y: number, time: number, source: "handle" | "content") {
    drag.current = { id, source, stop: stop.current, startY: y, height: ref.current!.getBoundingClientRect().height, lastY: y, lastTime: time, velocity: 0, moved: false };
  }
  function moveDrag(id: number, y: number, time: number) {
    const current = drag.current; if (!current || current.id !== id) return;
    const delta = y - current.startY;
    if (Math.abs(delta) > 5) { current.moved = true; setDragging(true); }
    if (!current.moved) return;
    const elapsed = time - current.lastTime;
    if (elapsed > 0) current.velocity = (y - current.lastY) / elapsed;
    current.lastY = y; current.lastTime = time;
    const minimum = current.stop > 0 ? stops.current[current.stop - 1] : 32;
    setHeight(Math.max(minimum, Math.min(stops.current[2], current.height - delta)));
  }
  function finishDrag(id: number, y: number, time: number, cancelled = false) {
    const current = drag.current; if (!current || current.id !== id) return;
    drag.current = undefined; setDragging(false);
    if (!current.moved) return;
    suppressClickUntil.current = Date.now() + 300;
    const velocity = time - current.lastTime > 100 ? 0 : current.velocity;
    const target = cancelled ? current.stop : settleSheet(current.height - (y - current.startY), velocity, stops.current, { stop: current.stop, height: current.height });
    if (target === null) { snap(stop.current); close.current(); }
    else snap(target);
  }
  function start(e: PointerEvent<HTMLElement>) {
    if (!mobile.current || !e.isPrimary || e.button !== 0) return;
    beginDrag(e.pointerId, e.clientY, e.timeStamp, "handle");
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function move(e: PointerEvent<HTMLElement>) {
    if (drag.current?.source !== "handle") return;
    e.preventDefault();
    moveDrag(e.pointerId, e.clientY, e.timeStamp);
  }
  function finish(e: PointerEvent<HTMLElement>, cancelled = false) {
    if (drag.current?.source === "handle") finishDrag(e.pointerId, e.clientY, e.timeStamp, cancelled);
  }
  useEffect(() => {
    const container = body.current;
    if (!dragFromContent || variant !== "resizable" || !container) return;
    let candidate: { id: number; x: number; y: number; time: number } | undefined;
    const cancel = () => {
      candidate = undefined;
      const current = drag.current;
      if (current?.source === "content") finishDrag(current.id, current.lastY, current.lastTime, true);
    };
    const startContent = (event: TouchEvent) => {
      candidate = undefined;
      if (event.touches.length !== 1) { cancel(); return; }
      if (!mobile.current || drag.current || container.scrollTop > 1 || !(event.target instanceof Element)) return;
      if (event.target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"])')) return;
      for (let node = event.target; node !== container && node; node = node.parentElement!) {
        if (node.scrollHeight > node.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(node).overflowY)) return;
      }
      const touch = event.touches[0];
      candidate = { id: touch.identifier, x: touch.clientX, y: touch.clientY, time: event.timeStamp };
    };
    const moveContent = (event: TouchEvent) => {
      const selection = window.getSelection();
      if (event.touches.length !== 1 || selection && !selection.isCollapsed) { cancel(); return; }
      const touch = event.touches[0];
      if (candidate) {
        const decision = contentPullDecision(container.scrollTop, touch.clientX - candidate.x, touch.clientY - candidate.y, stop.current);
        if (decision === "pending") return;
        if (decision === "scroll" || !event.cancelable) { candidate = undefined; return; }
        beginDrag(candidate.id, candidate.y, candidate.time, "content"); candidate = undefined;
      }
      if (drag.current?.source !== "content" || drag.current.id !== touch.identifier) return;
      if (!event.cancelable) { cancel(); return; }
      event.preventDefault(); container.scrollTop = 0;
      moveDrag(touch.identifier, touch.clientY, event.timeStamp);
    };
    const endContent = (event: TouchEvent) => {
      candidate = undefined;
      const current = drag.current; if (current?.source !== "content") return;
      const touch = Array.from(event.changedTouches).find((value) => value.identifier === current.id);
      if (!touch) return;
      if (event.cancelable) event.preventDefault();
      finishDrag(touch.identifier, touch.clientY, event.timeStamp);
    };
    // Claim vertical edge pulls below full height; scrolling inside a full sheet stays native.
    container.addEventListener("touchstart", startContent, { passive: true });
    container.addEventListener("touchmove", moveContent, { passive: false });
    container.addEventListener("touchend", endContent, { passive: false });
    container.addEventListener("touchcancel", cancel, { passive: true });
    return () => {
      container.removeEventListener("touchstart", startContent); container.removeEventListener("touchmove", moveContent);
      container.removeEventListener("touchend", endContent); container.removeEventListener("touchcancel", cancel);
      if (drag.current?.source === "content") drag.current = undefined;
    };
  }, [dragFromContent, variant]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.focus({ preventScroll: true });
    const keyboard = (e: KeyboardEvent) => {
      if (document.querySelector(".app-recovery")) return;
      if (document.querySelector("dialog[data-app-dialog][open]")) return;
      if (e.key === "Escape") { e.preventDefault(); close.current(); }
      if (e.key !== "Tab") return;
      const items = Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), summary, [tabindex="0"]') ?? []).filter((el) => el.getClientRects().length);
      if (!items.length) return;
      if (document.activeElement === ref.current || !ref.current?.contains(document.activeElement)) { e.preventDefault(); items[e.shiftKey ? items.length - 1 : 0].focus(); return; }
      if (e.shiftKey && document.activeElement === items[0]) { e.preventDefault(); items[items.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === items[items.length - 1]) { e.preventDefault(); items[0].focus(); }
    };
    document.addEventListener("keydown", keyboard);
    return () => { document.removeEventListener("keydown", keyboard); if (previous?.isConnected) previous.focus(); };
  }, []);
  if (typeof document === "undefined") return null;
  const fullScreen = fullScreenAtMax && !!viewport && stop.current === 2;
  const collapsed = !!summary && !!viewport && stop.current === 0 && !dragging;
  return createPortal(<div className="modal-root" style={viewport ? { top: viewport.top, height: viewport.height, bottom: "auto" } : undefined}><div className="sheet-backdrop" onClick={onClose} /><section ref={ref} tabIndex={-1} className={`sheet${variant === "compact" ? " sheet-compact" : ""}${dragging ? " is-dragging" : ""}${fullScreen ? " is-fullscreen" : ""}${collapsed ? " is-collapsed" : ""} ${className}`} data-resizable={!!viewport && variant === "resizable"} data-sheet-stop={stop.current} style={height === undefined ? undefined : { height }} onPointerDown={(event) => {
      if (dragFromContent && event.target instanceof Element && event.target.closest("[data-sheet-drag]") && !event.target.closest("button,a,input,textarea,select")) start(event);
    }} onPointerMove={move} onPointerUp={(event) => finish(event)} onPointerCancel={(event) => finish(event, true)} onLostPointerCapture={(event) => finish(event, true)} onTransitionEnd={revealInput} role={dialogRole} aria-modal="true" aria-label={title}>
    {variant === "resizable" && <div className="sheet-handle" tabIndex={fullScreen ? -1 : 0} aria-hidden={fullScreen || undefined} role="separator" aria-orientation="horizontal" aria-label="패널 크기 조절" aria-valuemin={0} aria-valuemax={2} aria-valuenow={stop.current} aria-valuetext={["낮게 접힘", "중간 높이", "최대로 펼침"][stop.current]} onPointerDown={start}
      onKeyDown={(e) => { if (["ArrowUp", "ArrowDown", "Home", "End"].includes(e.key)) { e.preventDefault(); snap(e.key === "Home" ? 0 : e.key === "End" ? 2 : Math.max(0, Math.min(2, stop.current + (e.key === "ArrowUp" ? 1 : -1))) as SheetStop); } }}><span className="grabber" /><span className="sr-only">위아래로 드래그하거나 방향키로 크기를 바꿔요. 아래로 끝까지 내리면 닫혀요.</span></div>}
    <div className="sheet-heading">
      {fullScreenAtMax && <button type="button" className="icon-btn sheet-back-btn" aria-label="뒤로 가기" onClick={() => snap(1)}><Icon name="back" width="22" /></button>}
      {summary ? <div ref={summaryRef} className="sheet-summary" data-sheet-drag={dragFromContent || undefined}>{summary}</div> : <h2>{title}</h2>}
      {headerActions && <div className="sheet-heading-actions">{headerActions}</div>}
    </div>
    <div ref={body} className="sheet-body" inert={collapsed || undefined} onClickCapture={(event) => { if (dragFromContent && Date.now() < suppressClickUntil.current) { event.preventDefault(); event.stopPropagation(); } }}>{children}</div>
    {footer && <div ref={footerRef} className="sheet-footer">{footer}</div>}</section></div>, document.body);
}
