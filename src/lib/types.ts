export type MediaType = "post" | "carousel" | "reel" | "unknown";
export type PlaceStatus = "wish" | "visited" | "again" | "meh";
export type SourceStatus = "processing" | "pending_confirm" | "done" | "needs_review" | "needs_caption";

/** 카카오 로컬 검색 결과를 우리 형식으로 바꾼 것 */
export interface KakaoPlace {
  kakao_place_id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  category: string;
  kakao_url: string;
}

export const STATUS_LABEL: Record<PlaceStatus, string> = {
  wish: "가고 싶음",
  visited: "다녀옴",
  again: "또 갈래",
  meh: "별로",
};
