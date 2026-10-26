import Modal from "./Modal";
import type { PlaceSheetLayoutProps } from "./PlaceSheetLayout";
import styles from "./ListPlaceSheet.module.css";

export default function ListPlaceSheet({ title, summary, preview, overview, details, closeAction, footer, onClose }: PlaceSheetLayoutProps) {
  return <Modal title={title} className={`sheet-place sheet-list ${styles.layout}`} fullScreenAtMax
    initialStop={1} dragFromContent onClose={onClose} headerActions={closeAction} footer={footer}>
    {preview}
    <div data-sheet-drag>{summary}</div>
    {overview}
    {details}
  </Modal>;
}
