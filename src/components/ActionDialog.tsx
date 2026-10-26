"use client";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import Icon from "./Icon";

/** Native modal focus and hit testing stay separate from the draggable sheet below. */
export default function ActionDialog({ title, message, children, onClose, onConfirm = onClose, confirmLabel = "확인", cancelLabel, busy = false, busyLabel = "처리 중…", destructive = false, tone = "success" }: {
  title: string; message?: string; children?: ReactNode; onClose: () => void; onConfirm?: () => void | Promise<void>;
  confirmLabel?: string; cancelLabel?: string; busy?: boolean; busyLabel?: string; destructive?: boolean; tone?: "success" | "error" | "info";
}) {
  const ref = useRef<HTMLDialogElement>(null); const id = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog || document.querySelector(".app-recovery")) return;
    dialog.showModal();
    return () => { if (dialog.open) dialog.close(); };
  }, []);
  if (typeof document === "undefined") return null;
  return createPortal(<dialog ref={ref} data-app-dialog className={`action-dialog${destructive ? " is-destructive" : ""} tone-${tone}`} role={destructive || tone === "error" ? "alertdialog" : "dialog"} aria-modal="true" aria-labelledby={`${id}-title`} aria-describedby={message || children ? `${id}-content` : undefined}
    onKeyDown={(event) => {
      if (event.key !== "Tab") return;
      const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
      const target = event.shiftKey ? buttons.at(-1) : buttons[0];
      if (buttons.length === 1 || document.activeElement === (event.shiftKey ? buttons[0] : buttons.at(-1))) { event.preventDefault(); target?.focus(); }
    }}
    onCancel={(event) => { event.preventDefault(); event.stopPropagation(); if (!busy) onClose(); }}
    onClick={(event) => {
      if (event.target !== event.currentTarget || busy) return;
      const box = event.currentTarget.getBoundingClientRect();
      if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) onClose();
    }}>
    <form method="dialog" onSubmit={(event) => { event.preventDefault(); if (!busy) void onConfirm(); }}>
      <span className="action-dialog-icon"><Icon name={destructive ? "trash" : tone === "error" ? "close" : tone === "info" ? "pin" : "check"} width="27" /></span>
      <h2 id={`${id}-title`}>{title}</h2>
      {(message || children) && <div id={`${id}-content`} className="action-dialog-content">{message && <p>{message}</p>}{children}</div>}
      <div className="action-dialog-actions">{cancelLabel && <button type="button" className="btn" autoFocus disabled={busy} onClick={onClose}>{cancelLabel}</button>}<button type="submit" className={`btn ${destructive ? "action-dialog-danger" : "primary"}`} autoFocus={!cancelLabel} disabled={busy}>{busy ? busyLabel : confirmLabel}</button></div>
    </form>
  </dialog>, document.body);
}
