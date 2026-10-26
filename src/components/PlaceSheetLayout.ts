import type { ReactNode } from "react";

/** Shared data/actions; each view owns its rendered order, heights and layout CSS. */
export type PlaceSheetLayoutProps = {
  title: string;
  summary: ReactNode;
  overview: ReactNode;
  details: ReactNode;
  preview: ReactNode;
  closeAction: ReactNode;
  footer: ReactNode;
  onClose: () => void;
};
