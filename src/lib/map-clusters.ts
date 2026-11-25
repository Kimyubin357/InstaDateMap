import { PLACE_STATUS_ENABLED } from "@/lib/features";
import type { PlaceStatus } from "./types";
import type { MapRegion } from "./map-regions";
import { REGION_NAMES } from "./place-view";

// Kakao levels increase as the map zooms out (scale bar: 7 = 1km, 9 = 4km, 12 = 32km). Below CLUSTER_MIN_LEVEL every place
// keeps its own pin (작은 원 + 이름) and only pins that overlap on screen merge into a count circle — 1km에서도 겹치지 않으면
// 이름이 보입니다(2026-11-26, 쏙핀처럼). From 2km on: 도 13–14 · 시 10–12 · 구 8–9 region cards.
export const CLUSTER_MIN_LEVEL = 8;
export const DISTRICT_CLUSTER_LEVEL = 8;
/** 고른 장소·숫자 원을 눌렀을 때 더 가까이 가지 않는 단계(50m) */
export const PIN_FLOOR_LEVEL = 3;
export const CITY_CLUSTER_LEVEL = 10;
export const PROVINCE_CLUSTER_LEVEL = 13;
export interface ClusterPlace { id: string; status: PlaceStatus }
export interface ScreenPoint { x: number; y: number }
export interface MarkerSize { width: number; height: number }
export type RegionTier = "province" | "city" | "district" | "local";

/** One card per administrative area: 경기 → 수원시 → 장안구 → 정자1동 as the map zooms in. */
export interface RegionCard<T extends ClusterPlace> extends ScreenPoint {
  key: string;
  tier: RegionTier;
  /** Full administrative key (e.g. "서울특별시 성동구"); null when the lookup has not resolved. */
  area: string | null;
  /** Short display name (e.g. "성동구"); null shows the number alone. */
  label: string | null;
  places: T[];
  /** The number on the card: only "가고 싶음" places (every place on the map while PLACE_STATUS_ENABLED is off). */
  wish: number;
  /** NEW places among the card's places. */
  fresh: number;
  /** Progress bar: visited (anything but 가고 싶음) out of every saved place in the area, filters ignored. */
  visited: number;
  total: number;
}

export function regionTier(level: number): RegionTier {
  return level >= PROVINCE_CLUSTER_LEVEL ? "province" : level >= CITY_CLUSTER_LEVEL ? "city" : level >= DISTRICT_CLUSTER_LEVEL ? "district" : "local";
}

/** Areas never fall back to a wider one: unknown parts stay separate rather than merging wrongly. */
export function regionArea(region: MapRegion | null | undefined, tier: RegionTier) {
  if (!region) return null;
  return (tier === "province" ? region.province : tier === "city" ? region.city : tier === "district" ? region.district : region.local) || null;
}

const METROPOLITAN = /(특별시|광역시|특별자치시)$/;
/** "서울특별시" → "서울", "경기도" → "경기", "경기도 수원시 장안구" → "장안구", "… 성수1가1동" → "성수1가1동". */
export function shortRegionName(area: string) {
  const last = area.trim().split(/\s+/).at(-1) || "";
  return REGION_NAMES[last] || last.replace(METROPOLITAN, "") || last;
}

interface CardOptions<T> {
  level: number;
  region: (place: T) => MapRegion | null | undefined;
  isNew: (place: T) => boolean;
  /** Every saved place (filters ignored) for the progress bar. */
  allPlaces?: readonly T[];
}

export function regionCards<T extends ClusterPlace>(places: readonly T[], project: (place: T) => ScreenPoint, options: CardOptions<T>): RegionCard<T>[] {
  const tier = regionTier(options.level);
  const stats = new Map<string, { visited: number; total: number }>();
  for (const place of new Map((options.allPlaces ?? places).map((p) => [p.id, p])).values()) {
    const area = regionArea(options.region(place), tier);
    if (!area) continue;
    const entry = stats.get(area) ?? { visited: 0, total: 0 };
    entry.total += 1; if (place.status !== "wish") entry.visited += 1;
    stats.set(area, entry);
  }
  const groups = new Map<string, { area: string | null; items: { place: T; point: ScreenPoint }[] }>();
  const unique = [...new Map(places.map((place) => [place.id, place])).values()].sort((a, b) => a.id.localeCompare(b.id));
  for (const place of unique) {
    const point = project(place);
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
    const area = regionArea(options.region(place), tier);
    const key = area ? `area:${area}` : `place:${place.id}`;
    const group = groups.get(key) ?? { area, items: [] };
    group.items.push({ place, point }); groups.set(key, group);
  }
  return [...groups.entries()].map(([key, { area, items }]) => {
    const own = items.map(({ place }) => place);
    const stat = (area && stats.get(area)) || { visited: own.filter((p) => p.status !== "wish").length, total: own.length };
    return {
      key, tier, area, label: area ? shortRegionName(area) : null, places: own,
      x: items.reduce((sum, { point }) => sum + point.x, 0) / items.length,
      y: items.reduce((sum, { point }) => sum + point.y, 0) / items.length,
      wish: PLACE_STATUS_ENABLED ? own.filter((p) => p.status === "wish").length : own.length,
      fresh: own.filter(options.isNew).length,
      visited: stat.visited, total: stat.total,
    };
  });
}

/**
 * Overlapping cards are not hidden: they stay where their places are and simply overlap, so a peeking edge
 * invites zooming in. Returns the cards back to front: more places on the map are drawn on top
 * (ties: name order wins, unnamed cards at the back).
 */
export function stackCards<T extends ClusterPlace>(cards: readonly RegionCard<T>[]): RegionCard<T>[] {
  return [...cards].sort((a, b) => a.places.length - b.places.length
    || Number(b.label === null) - Number(a.label === null)
    || (b.label ?? "").localeCompare(a.label ?? "", "ko") || b.key.localeCompare(a.key));
}

const TIERS: RegionTier[] = ["province", "city", "district", "local"];
/** The least zoomed-in Kakao level of each tier (도 14 · 시 12 · 구 9 · 핀 7). */
const TIER_TOP: Record<RegionTier, number> = { province: 14, city: 12, district: 9, local: 7 };
/**
 * Tapping a card must change what is shown: zoom at least into the next tier, skipping tiers where the
 * card's places are still the very same area under another tier name (서울 도 → 서울 시 → 구,
 * 세종 → 동, 과천시 → 동). Returns the Kakao level to zoom in to at most.
 */
export function zoomInLevel<T extends ClusterPlace>(card: RegionCard<T>, region: (place: T) => MapRegion | null | undefined) {
  let index = TIERS.indexOf(card.tier) + 1;
  while (index < TIERS.length - 1 && card.area !== null
    && card.places.every((place) => regionArea(region(place), TIERS[index]) === card.area)) index++;
  return TIER_TOP[TIERS[Math.min(index, TIERS.length - 1)]];
}

/** 핀끼리 겹침: 원 지름(30px)보다 가까우면 한 숫자 원으로 묶습니다. */
export const PIN_OVERLAP = 30;
export interface PinCluster<T> extends ScreenPoint { key: string; places: T[] }
/**
 * 화면에서 겹치는 핀만 묶습니다(축척과 상관없음). 같은 입력이면 늘 같은 결과가 나오게 id 순서로 처리하고,
 * 묶음 중심은 들어간 장소들의 평균 위치입니다. 묶음끼리 다시 겹치면 한 번 더 합칩니다.
 */
export function overlapClusters<T extends { id: string }>(places: readonly T[], project: (place: T) => ScreenPoint, distance = PIN_OVERLAP): PinCluster<T>[] {
  const unique = [...new Map(places.map((place) => [place.id, place])).values()].sort((a, b) => a.id.localeCompare(b.id));
  let groups: { places: T[]; x: number; y: number }[] = [];
  for (const place of unique) {
    const point = project(place);
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
    const near = groups.find((g) => Math.hypot(g.x - point.x, g.y - point.y) < distance);
    if (near) { const n = near.places.length; near.x = (near.x * n + point.x) / (n + 1); near.y = (near.y * n + point.y) / (n + 1); near.places.push(place); }
    else groups.push({ places: [place], x: point.x, y: point.y });
  }
  for (let merged = true; merged;) {
    merged = false;
    outer: for (let i = 0; i < groups.length; i++) for (let j = i + 1; j < groups.length; j++) {
      const a = groups[i], b = groups[j];
      if (Math.hypot(a.x - b.x, a.y - b.y) >= distance) continue;
      const n = a.places.length, m = b.places.length;
      groups[i] = { places: [...a.places, ...b.places], x: (a.x * n + b.x * m) / (n + m), y: (a.y * n + b.y * m) / (n + m) };
      groups = groups.filter((_, index) => index !== j); merged = true; break outer;
    }
  }
  return groups.map((g) => ({ key: g.places.map((p) => p.id).sort().join("|"), places: g.places, x: g.x, y: g.y }));
}
