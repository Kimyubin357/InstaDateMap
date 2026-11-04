"use client";
import { useEffect, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import Icon from "./Icon";
import styles from "./SelectedPlacesBar.module.css";

export default function SelectedPlacesBar({ workspace, count, onCollect, onDelete }: {
  workspace: RefObject<HTMLElement | null>; count: number; onCollect: () => void; onDelete: () => void;
}) {
  const [host, setHost] = useState<Element | null>(null);
  useEffect(() => { setHost(workspace.current?.closest(".app-root") ?? document.body); }, [workspace]);
  if (!host) return null;
  return createPortal(<div className={styles.bar} data-selection-actions role="group" aria-label="선택한 장소 작업">
    <div className={styles.actions}>
      <button type="button" className={`btn ${styles.collect}`} disabled={!count} onClick={onCollect}><Icon name="bag" width={20} />모음에 담기</button>
      <button type="button" className={`btn ${styles.remove}`} disabled={!count} onClick={onDelete}><Icon name="trash" width={20} />삭제</button>
    </div>
  </div>, host);
}
