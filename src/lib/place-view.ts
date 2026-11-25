import { PLACE_STATUS_ENABLED } from "@/lib/features";
import type { PlaceStatus } from "./types";
export interface PlaceView {
  id: string; name: string; address: string | null; lat: number; lng: number; category: string | null;
  kakao_place_id: string | null; kakao_url: string | null; status: PlaceStatus; memo: string | null; memo_version?: number; sharers: string[];
  /** 처음 등록한 사람의 지금 이름(삭제 권한: 이 사람만, 이 사람이 방에 없으면 멤버 누구나). 017 */
  registrant?: string | null;
  /** 처음 등록한 사람의 계정 id. id가 없는 예전 기록이면 null. 019 */
  registrant_id?: string | null;
  sources: { url: string; media_type: string }[]; created_at: string; last_saved_at: string;
}
/**
 * 삭제 권한(017): 처음 등록한 사람만. 등록한 사람이 방에 없으면(나갔거나 탈퇴) 멤버 누구나.
 * 019부터 계정 id로 비교해 이름을 바꿔도 같은 사람으로 봅니다. id가 없는 예전 기록만 이름으로 비교합니다.
 * 서버(dm_delete_place)도 같은 기준으로 막습니다.
 */
export function canDeletePlace(place: Pick<PlaceView, "registrant" | "registrant_id">, who: string, memberNames: string[], me: { userId?: string; memberIds?: string[] } = {}) {
  if (place.registrant_id && me.userId && me.memberIds) return place.registrant_id === me.userId || !me.memberIds.includes(place.registrant_id);
  const registrant = place.registrant;
  return !registrant || registrant === who || !memberNames.includes(registrant);
}
export const STATUS_ORDER: PlaceStatus[] = ["wish", "again", "visited", "meh"];
/** Map and list open on the places still to visit; filter reset returns here. With statuses hidden, every place shows. */
export const DEFAULT_STATUSES: PlaceStatus[] = PLACE_STATUS_ENABLED ? ["wish", "again"] : [...STATUS_ORDER];
export function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const rad = (n: number) => n * Math.PI / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}
/**
 * 검색 비교용 글자. 겉모양은 같아도 자모가 나뉜 한글(NFD·호환 자모)이나 보이지 않는 글자가 섞이면
 * includes가 실패하므로, 검색어와 대상을 같은 형태로 맞춥니다.
 */
export function searchKey(text: string) {
  return text.normalize("NFKC").replace(/[​-‍⁠﻿]/g, "").toLocaleLowerCase();
}
export function filterPlaces(places: PlaceView[], query: string, statuses: PlaceStatus[], category: string) {
  const words = searchKey(query).trim().split(/\s+/).filter(Boolean);
  return places.filter((p) => statuses.includes(p.status) && (!category || p.category === category) &&
    words.every((w) => searchKey(`${p.name} ${p.address || ""} ${p.memo || ""}`).includes(w)));
}
export function sortPlaces(places: PlaceView[], origin?: { lat: number; lng: number } | null) {
  return [...places].sort((a, b) => origin ? distanceM(origin, a) - distanceM(origin, b) :
    (b.last_saved_at || b.created_at).localeCompare(a.last_saved_at || a.created_at));
}

/** Short province names, also used for the zoomed-out map cards (경기도 → 경기). */
export const REGION_NAMES: Record<string, string> = {
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
