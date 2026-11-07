"use client";
import { useEffect, useId, useRef, useSyncExternalStore, type ComponentProps, type ReactNode } from "react";
import { createPortal } from "react-dom";
import Icon from "./Icon";

const LANDSCAPE = "(orientation: landscape)";
function subscribe(change: () => void) {
  const media = matchMedia(LANDSCAPE);
  media.addEventListener("change", change);
  return () => media.removeEventListener("change", change);
}
/** Portrait shows map states as a centred modal; landscape keeps them in the left column. */
export function useLandscape() {
  return useSyncExternalStore(subscribe, () => matchMedia(LANDSCAPE).matches, () => false);
}

export interface MapStatusContent {
  tone: "info" | "error";
  icon: ComponentProps<typeof Icon>["name"];
  title: string;
  message?: string;
  actions?: ReactNode;
  /** Loading states close by themselves; every other state has an X. */
  closable: boolean;
}

export default function MapStatus({ status, landscape, onClose }: { status: MapStatusContent; landscape: boolean; onClose: () => void }) {
  const id = useId();
  const body = <>
    {status.closable && <button type="button" className="icon-btn map-status-close" aria-label="안내 닫기" onClick={onClose}><Icon name="close" width="18" /></button>}
    <span className="action-dialog-icon map-status-icon"><Icon name={status.icon} width="27" /></span>
    <h2 id={`${id}-title`}>{status.title}</h2>
    {status.message && <div id={`${id}-content`} className="action-dialog-content"><p>{status.message}</p></div>}
    {status.actions && <div className="action-dialog-actions map-status-actions">{status.actions}</div>}
  </>;
  if (landscape) return <section className={`map-status-card tone-${status.tone}`} role={status.tone === "error" ? "alert" : "status"} aria-labelledby={`${id}-title`}>{body}</section>;
  return <MapStatusDialog id={id} status={status} onClose={onClose}>{body}</MapStatusDialog>;
}

/** A native modal dialog dims the whole screen and blocks the map until the state ends or is closed. */
function MapStatusDialog({ id, status, onClose, children }: { id: string; status: MapStatusContent; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    dialog.showModal();
    return () => { if (dialog.open) dialog.close(); };
  }, []);
  if (typeof document === "undefined") return null;
  return createPortal(<dialog ref={ref} data-app-dialog className={`action-dialog map-status-dialog tone-${status.tone}`}
    role={status.tone === "error" ? "alertdialog" : "dialog"} aria-modal="true" aria-labelledby={`${id}-title`} aria-describedby={status.message ? `${id}-content` : undefined}
    aria-busy={!status.closable || undefined}
    onCancel={(event) => { event.preventDefault(); if (status.closable) onClose(); }}>{children}</dialog>, document.body);
}
