import type { PlaceStatus } from "./types";
import type { MapRegion } from "./map-regions";

// Kakao levels increase as the map zooms out. Below CLUSTER_MIN_LEVEL every place keeps its own name pin.
export const CLUSTER_MIN_LEVEL = 4;
export const DISTRICT_CLUSTER_LEVEL = 8;
export const CITY_CLUSTER_LEVEL = 10;
export interface ClusterPlace { id: string; status: PlaceStatus }
export interface ScreenPoint { x: number; y: number }
export interface MarkerSize { width: number; height: number }
export type RegionTier = "city" | "district" | "local";

/** One card per administrative area: 서울 → 성동구 → 성수1가1동 as the map zooms in. */
export interface RegionCard<T extends ClusterPlace> extends ScreenPoint {
  key: string;
  tier: RegionTier;
  /** Full administrative key (e.g. "서울특별시 성동구"); null when the lookup has not resolved. */
  area: string | null;
  /** Short display name (e.g. "성동구"); null shows the number alone. */
  label: string | null;
  places: T[];
  /** The number on the card: only "가고 싶음" places. */
  wish: number;
  /** NEW places among the card's places. */
  fresh: number;
  /** Progress bar: visited (anything but 가고 싶음) out of every saved place in the area, filters ignored. */
  visited: number;
  total: number;
}

export function regionTier(level: number): RegionTier {
  return level >= CITY_CLUSTER_LEVEL ? "city" : level >= DISTRICT_CLUSTER_LEVEL ? "district" : "local";
}

/** Areas never fall back to a wider one: unknown parts stay separate rather than merging wrongly. */
export function regionArea(region: MapRegion | null | undefined, tier: RegionTier) {
  if (!region) return null;
  return (tier === "city" ? region.city : tier === "district" ? region.district : region.local) || null;
}

const METROPOLITAN = /(특별시|광역시|특별자치시)$/;
/** "서울특별시" → "서울", "경기도 수원시 장안구" → "장안구", "… 성수1가1동" → "성수1가1동". */
export function shortRegionName(area: string) {
  const last = area.trim().split(/\s+/).at(-1) || "";
  return last.replace(METROPOLITAN, "") || last;
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
      wish: own.filter((p) => p.status === "wish").length,
      fresh: own.filter(options.isNew).length,
      visited: stat.visited, total: stat.total,
    };
  });
}

/** Cards are drawn above their point with an 8px tail, like the earlier count pins. */
const TAIL = 8, GAP = 4;
/**
 * City and district cards that collide keep the one with more places on the map (ties: name order,
 * unnamed last). The hidden area's places are not added elsewhere; zooming in reveals them.
 * Neighbourhood cards are left as they are for now (to be judged on a real map).
 */
export function hideOverlappingCards<T extends ClusterPlace>(cards: readonly RegionCard<T>[], size: (card: RegionCard<T>) => MarkerSize): RegionCard<T>[] {
  if (!cards.length || cards[0].tier === "local") return [...cards];
  const ordered = [...cards].sort((a, b) => b.places.length - a.places.length
    || Number(a.label === null) - Number(b.label === null)
    || (a.label ?? "").localeCompare(b.label ?? "", "ko") || a.key.localeCompare(b.key));
  const kept: { card: RegionCard<T>; left: number; right: number; top: number; bottom: number }[] = [];
  for (const card of ordered) {
    const { width, height } = size(card);
    const box = { card, left: card.x - width / 2 - GAP, right: card.x + width / 2 + GAP, top: card.y - TAIL - height - GAP, bottom: card.y + GAP };
    if (kept.some((k) => box.left < k.right && box.right > k.left && box.top < k.bottom && box.bottom > k.top)) continue;
    kept.push(box);
  }
  return kept.map(({ card }) => card);
}
