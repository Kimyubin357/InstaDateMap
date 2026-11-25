import Modal from "./Modal";
import type { PlaceSheetLayoutProps } from "./PlaceSheetLayout";
import styles from "./MapPlaceSheet.module.css";

/** 장소 상세 시트(지도·리스트 공통): 접힘 → 중간(사진까지) → 끝까지(화면을 채우는 창). */
export default function MapPlaceSheet({ title, summary, overview, details, closeAction, footer, onClose }: PlaceSheetLayoutProps) {
  return <Modal title={title} className={`sheet-place ${styles.layout}`} summary={summary}
    initialStop={1} dragFromContent onClose={onClose} headerActions={closeAction} footer={footer}>
    <div data-sheet-preview>{overview}</div>
    {details}
  </Modal>;
}
