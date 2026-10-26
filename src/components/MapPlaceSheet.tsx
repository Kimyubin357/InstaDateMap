import Modal from "./Modal";
import type { PlaceSheetLayoutProps } from "./PlaceSheetLayout";
import styles from "./MapPlaceSheet.module.css";

export default function MapPlaceSheet({ title, summary, overview, details, closeAction, footer, onClose }: PlaceSheetLayoutProps) {
  return <Modal title={title} className={`sheet-place sheet-map ${styles.layout}`} summary={summary}
    initialStop={1} dragFromContent onClose={onClose} headerActions={closeAction} footer={footer}>
    <div data-sheet-preview>{overview}</div>
    {details}
  </Modal>;
}
