"use client";
import { useEffect, useRef, type ReactNode } from "react";
import Icon from "./Icon";
export default function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLElement>(null); const close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLButtonElement>("button")?.focus();
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
  return <div className="modal-root"><div className="sheet-backdrop" onClick={onClose} /><section ref={ref} className="sheet" role="dialog" aria-modal="true" aria-label={title}><div className="grabber" /><div className="sheet-heading"><h2>{title}</h2><button className="icon-btn" aria-label="닫기" onClick={onClose}><Icon name="close" /></button></div>{children}</section></div>;
}
