import type { PlaceStatus } from "./types";
export interface PlaceView {
  id: string; name: string; address: string | null; lat: number; lng: number; category: string | null;
  kakao_place_id: string | null; kakao_url: string | null; status: PlaceStatus; memo: string | null; memo_version?: number; sharers: string[];
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

const REGION_NAMES: Record<string, string> = {
  서울특별시: "서울", 서울시: "서울", 부산광역시: "부산", 부산시: "부산",
  대구광역시: "대구", 대구시: "대구", 인천광역시: "인천", 인천시: "인천",
  광주광역시: "광주", 대전광역시: "대전", 대전시: "대전", 울산광역시: "울산", 울산시: "울산",
  세종특별자치시: "세종", 세종시: "세종", 경기도: "경기",
  강원도: "강원", 강원특별자치도: "강원", 충청북도: "충북", 충청남도: "충남",
  전라북도: "전북", 전북특별자치도: "전북", 전라남도: "전남",
  경상북도: "경북", 경상남도: "경남", 제주도: "제주", 제주특별자치도: "제주",
};
const METROPOLITAN_REGIONS = new Set(["서울", "부산", "대구", "인천", "광주", "대전", "울산", "세종"]);
const PROVINCES = new Set(["경기", "강원", "충북", "충남", "전북", "전남", "경북", "경남", "제주"]);

// Display labels come from the saved address. Map clustering still uses Kakao's
// structured administrative boundaries, not these abbreviated display names.
function placeRegion(address: string | null): string {
  const [first, second = "", third = ""] = address?.trim().split(/\s+/) || [];
  if (!first) return "";
  const region = REGION_NAMES[first] || first;
  if (METROPOLITAN_REGIONS.has(region)) {
    const subdivision = region === "세종" ? /[읍면동]$/.test(second) : /[구군]$/.test(second);
    return subdivision ? `${region} ${second}` : region;
  }
  if (PROVINCES.has(region)) {
    if (/시$/.test(second) && /구$/.test(third)) return `${second.slice(0, -1)} ${third}`;
    // Keep the province for places such as 강원 고성군 and 경남 고성군,
    // and distinguish 경기 광주시 from the metropolitan city of 광주.
    return /[시군]$/.test(second) ? `${region} ${second}` : region;
  }
  if (/시$/.test(first) && /구$/.test(second)) return `${first.slice(0, -1)} ${second}`;
  return first;
}

export function placeMeta(place: Pick<PlaceView, "category" | "address">) {
  const region = placeRegion(place.address);
  return [place.category, region].filter(Boolean).join(" · ");
}
