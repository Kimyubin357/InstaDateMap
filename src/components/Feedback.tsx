"use client";
import { useEffect } from "react";
import { createPortal } from "react-dom";
import Icon from "./Icon";

export interface ToastNotice { message: string; tone: "success" | "info" }
export default function Feedback({ toast, onDismiss, connection, onRetry, map }: {
  toast: ToastNotice | null; onDismiss: () => void; connection: string; onRetry: () => void; map: boolean;
}) {
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(onDismiss, 3500);
    return () => clearTimeout(timer);
  }, [toast, onDismiss]);
  if (typeof document === "undefined" || (!toast && !connection)) return null;
  return createPortal(<div className={`global-feedback${map ? " is-map" : ""}`}>
    {connection && <div className="sync-notice" role="status"><span>{connection} 마지막 조회 내용을 유지하고 있어요.</span><button className="text-btn" onClick={onRetry}>다시 연결</button></div>}
    {toast && <div className={`toast tone-${toast.tone}`} role="status"><Icon name={toast.tone === "success" ? "check" : "pin"} width="18" /><span>{toast.message}</span><button className="icon-btn" aria-label="알림 닫기" onClick={onDismiss}><Icon name="close" width="16" /></button></div>}
  </div>, document.body);
}
