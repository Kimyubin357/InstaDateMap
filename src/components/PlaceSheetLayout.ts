import type { ReactNode } from "react";

/** 장소 상세 한 가지 모양(시안 design-lab/place-detail, 2026-11-26): 지도·리스트가 같은 순서·높이·창을 씁니다. */
export type PlaceSheetLayoutProps = {
  title: string;
  summary: ReactNode;
  overview: ReactNode;
  details: ReactNode;
  closeAction: ReactNode;
  footer: ReactNode;
  onClose: () => void;
};
