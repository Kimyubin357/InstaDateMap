"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { friendlyMessage, RequestError } from "@/lib/client-request";
import Icon from "./Icon";
import ShellLink from "./ShellLink";
import ActionDialog from "./ActionDialog";

export type ToastAction = { label: string; href: string } | { label: string; onClick: () => Promise<string | void> };
export interface ToastNotice { id: number; message: string; tone: "success" | "info"; action?: ToastAction }
interface ToastProps {
  toast: ToastNotice;
  onDismiss: (toast: ToastNotice) => void;
  onActionComplete: (toast: ToastNotice, message: string) => void;
}

function Toast({ toast, onDismiss, onAction, onEngagement, busy, paused }: Omit<ToastProps, "onActionComplete"> & {
  onAction: (toast: ToastNotice) => void;
  onEngagement: (toast: ToastNotice, held: boolean) => void;
  busy: boolean; paused: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const remaining = useRef(toast.action ? 8000 : 3000);
  const [focused, setFocused] = useState(false), [hovered, setHovered] = useState(false);
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    const check = () => setHidden(document.hidden || !ref.current?.getClientRects().length);
    const observer = new ResizeObserver(check);
    if (ref.current) observer.observe(ref.current);
    document.addEventListener("visibilitychange", check); check();
    return () => { observer.disconnect(); document.removeEventListener("visibilitychange", check); };
  }, []);
  useEffect(() => {
    onEngagement(toast, focused || hovered);
    return () => onEngagement(toast, false);
  }, [toast, onEngagement, focused, hovered]);
  useEffect(() => {
    if (focused || hovered || hidden || busy || paused) return;
    const started = Date.now();
    const timer = setTimeout(() => onDismiss(toast), remaining.current);
    return () => { clearTimeout(timer); remaining.current = Math.max(0, remaining.current - (Date.now() - started)); };
  }, [toast, onDismiss, focused, hovered, hidden, busy, paused]);
  return <div ref={ref} className={`toast tone-${toast.tone}`} role="status" aria-atomic="true" aria-busy={busy}
    onFocusCapture={() => setFocused(true)} onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false); }}
    onPointerEnter={(event) => { if (event.pointerType === "mouse") setHovered(true); }} onPointerLeave={() => setHovered(false)}>
    <Icon name={toast.tone === "success" ? "check" : "pin"} width="18" />
    <span>{toast.message}</span>
    {toast.action && ("href" in toast.action
      ? <ShellLink className="toast-action" href={toast.action.href} onClick={() => onDismiss(toast)}>{toast.action.label}</ShellLink>
      : <button type="button" className="toast-action" disabled={busy} onClick={() => onAction(toast)}>{busy ? "확인 중…" : toast.action.label}</button>)}
  </div>;
}

type ActionState = { toast: ToastNotice; busy: boolean; error?: { message: string; retry: boolean } };
export default function Feedback({ toast, onDismiss, onActionComplete, connection, onRetry, map }: {
  toast: ToastNotice | null; onDismiss: ToastProps["onDismiss"]; onActionComplete: ToastProps["onActionComplete"];
  connection: string; onRetry: () => void; map: boolean;
}) {
  // Keep the action receipt and focused control alive while newer notices wait in the provider.
  const [action, setAction] = useState<ActionState | null>(null);
  const [heldToast, setHeldToast] = useState<ToastNotice | null>(null);
  const flight = useRef(false);
  const engage = useCallback((notice: ToastNotice, held: boolean) => {
    setHeldToast((current) => held ? notice : current === notice ? null : current);
  }, []);
  const dismiss = useCallback((notice: ToastNotice) => {
    setHeldToast((current) => current === notice ? null : current);
    onDismiss(notice);
  }, [onDismiss]);
  async function runAction(notice: ToastNotice) {
    if (!notice.action || !("onClick" in notice.action) || flight.current) return;
    flight.current = true;
    setAction((current) => ({ toast: notice, busy: true, error: current?.error }));
    try {
      const message = await notice.action.onClick();
      setHeldToast(null); setAction(null);
      if (message) onActionComplete(notice, message); else onDismiss(notice);
    } catch (cause) {
      setAction({ toast: notice, busy: false, error: {
        message: friendlyMessage(cause, "처리 결과를 확인하지 못했어요. 다시 시도해 주세요."),
        retry: !(cause instanceof RequestError && [400, 401, 403, 404, 409, 410].includes(cause.status)),
      } });
    } finally { flight.current = false; }
  }
  const visibleToast = action?.toast ?? heldToast ?? toast;
  const closeError = () => { if (action) dismiss(action.toast); setAction(null); };
  if (typeof document === "undefined" || (!visibleToast && !connection)) return null;
  return createPortal(<>
    <div className={`global-feedback${map ? " is-map" : ""}`}>
      {connection && <div className="sync-notice" role="status"><span>{connection === "오프라인이에요." ? "오프라인이에요." : "최신 내용을 불러오지 못했어요."}<small>마지막으로 불러온 내용을 보여드려요.</small></span><button className="text-btn" onClick={onRetry}>다시 연결</button></div>}
      {visibleToast && <Toast key={visibleToast.id} toast={visibleToast} onDismiss={dismiss} onAction={(notice) => void runAction(notice)} onEngagement={engage} busy={!!action?.busy} paused={!!action?.error} />}
    </div>
    {action?.error && <ActionDialog title="처리 결과를 확인해 주세요" message={action.error.message} tone="error" busy={action.busy}
      confirmLabel={action.error.retry ? "다시 확인" : "확인"} cancelLabel={action.error.retry ? "닫기" : undefined}
      onClose={closeError} onConfirm={action.error.retry ? () => runAction(action.toast) : closeError} />}
  </>, document.body);
}
