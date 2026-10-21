import type { PlaceStatus } from "./types";
export interface PlaceView {
  id: string; name: string; address: string | null; lat: number; lng: number; category: string | null;
  kakao_url: string | null; status: PlaceStatus; memo: string | null; sharers: string[];
  sources: { url: string; media_type: string }[]; created_at: string; last_saved_at: string;
}
export const STATUS_ORDER: PlaceStatus[] = ["wish", "again", "visited", "meh"];
export function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const rad = (n: number) => n * Math.PI / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}
export function filterPlaces(places: PlaceView[], query: string, statuses: PlaceStatus[], category: string) {
  const words = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  return places.filter((p) => statuses.includes(p.status) && (!category || p.category === category) &&
    words.every((w) => `${p.name} ${p.address || ""} ${p.memo || ""}`.toLocaleLowerCase().includes(w)));
}
export function sortPlaces(places: PlaceView[], origin?: { lat: number; lng: number } | null) {
  return [...places].sort((a, b) => origin ? distanceM(origin, a) - distanceM(origin, b) :
    (b.last_saved_at || b.created_at).localeCompare(a.last_saved_at || a.created_at));
}
export function placeMeta(place: Pick<PlaceView, "category" | "address">) {
  const region = place.address?.split(" ")[1]?.replace(/[시군구]$/, "");
  return [place.category, region].filter(Boolean).join(" · ");
}
