"use client";
import { useEffect, useRef, useState } from "react";
import Icon from "./Icon";
import FolderTransferDialog from "./FolderTransferDialog";
import { useBoardSync } from "./BoardProvider";
import { categoryIcon } from "@/lib/place-presentation";
import { placeMeta, type PlaceView } from "@/lib/place-view";
import styles from "./Registration.module.css";

/**
 * 저장 뒤 지도 위 '방금 담은 N곳'(시안 9번). 잘못 고른 방은 여기서 바로 [다른 방으로 옮기기]로 고칩니다.
 * 지도 도구(전체 보기·내 위치·+)와 하단 탭은 그대로 두고, 이 시트의 높이만큼 위로 올립니다(--just-saved-height).
 */
export default function JustSavedSheet({ room, places, url, onOpen, onClose }: {
  room: string; places: PlaceView[]; url: string | null; onOpen: (id: string) => void; onClose: () => void;
}) {
  const { notify, store } = useBoardSync();
  const [transferring, setTransferring] = useState(false);
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    // 토스트(칩)는 지도 밖(body)의 공통 영역이라 문서 루트에 높이를 둡니다.
    const root = document.documentElement; const sheet = ref.current;
    if (!sheet) return;
    const measure = () => root.style.setProperty("--just-saved-height", `${Math.ceil(sheet.getBoundingClientRect().height)}px`);
    const observer = new ResizeObserver(measure); observer.observe(sheet); measure();
    return () => { observer.disconnect(); root.style.removeProperty("--just-saved-height"); };
  }, []);
  return <section ref={ref} className={`${styles.justSheet} just-saved-sheet`} aria-labelledby="just-saved-title">
    <header className={styles.justHead}>
      <div><h2 id="just-saved-title">방금 담은 {places.length}곳</h2><p>{room} · 방금 · 인스타 게시물</p></div>
      <button type="button" className={styles.close} aria-label="방금 담은 장소 닫기" onClick={onClose}><span><Icon name="close" width={18} /></span></button>
    </header>
    <div className={styles.justBody}>
      {places.map((place) => <button key={place.id} type="button" className={styles.justRow} onClick={() => onOpen(place.id)}>
        <span className={`category-icon category-${categoryIcon(place.category)}`} aria-hidden="true"><Icon name={categoryIcon(place.category)} width={22} /></span>
        <span><strong>{place.name}</strong><small>{placeMeta(place) || place.address}</small></span>
        <Icon name="chevron" width={17} />
      </button>)}
    </div>
    <div className={styles.justActions}>
      <button type="button" className={`btn ${styles.forestText}`} onClick={() => setTransferring(true)}><Icon name="moveRoom" width={18} />다른 방으로 옮기기</button>
      {url && <a className="btn" href={url} target="_blank" rel="noreferrer"><Icon name="instagram" width={18} />원본 보기</a>}
    </div>
    {transferring && <FolderTransferDialog ids={places.map((p) => p.id)} onClose={() => setTransferring(false)} onDone={(result) => {
      // 방금 담은 곳은 내가 등록했으니 모두 옮겨지고, 이 방에서는 빠집니다.
      for (const id of result.moved_ids) store.removePlace(id);
      setTransferring(false); notify(`‘${result.folder}’ 방으로 옮겼어요.`); onClose();
    }} />}
  </section>;
}
