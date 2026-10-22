import type { PlaceStatus } from "./types";
import type { MapRegion } from "./map-regions";

// Kakao levels increase as the map zooms out.
export const CLUSTER_MIN_LEVEL = 4;
export const DISTRICT_CLUSTER_LEVEL = 8;
export const CITY_CLUSTER_LEVEL = 10;
export interface ClusterPlace { id: string; status: PlaceStatus }
export interface ScreenPoint { x: number; y: number }
export interface MarkerSize { width: number; height: number }
export interface PlaceCluster<T extends ClusterPlace> extends ScreenPoint {
  key: string;
  places: T[];
  visited: number;
  region: string | null;
}
interface ClusterOptions<T> {
  level: number;
  region: (place: T) => MapRegion | null | undefined;
  size: (place: T) => MarkerSize;
}

/** Only overlapping nameplates in the same verified administrative area can merge. */
export function clusterPlaces<T extends ClusterPlace>(places: readonly T[], project: (place: T) => ScreenPoint, options: ClusterOptions<T>): PlaceCluster<T>[] {
  const unique = [...new Map(places.map((place) => [place.id, place])).values()].sort((a, b) => a.id.localeCompare(b.id));
  const points = unique.map((place) => {
    const region = options.region(place), size = options.size(place), point = project(place);
    const area = options.level >= CITY_CLUSTER_LEVEL ? region?.city :
      options.level >= DISTRICT_CLUSTER_LEVEL ? region?.district : region?.local;
    return { place, ...point, area: area || null,
      left: point.x - size.width / 2 - 4, right: point.x + size.width / 2 + 4,
      top: point.y - size.height - 12, bottom: point.y - 4 };
  }).filter((p) => [p.x, p.y, p.left, p.right, p.top, p.bottom].every(Number.isFinite));
  const parents = points.map((_, index) => index);
  const buckets = new Map<string, number[]>();
  function root(index: number): number {
    while (parents[index] !== index) { parents[index] = parents[parents[index]]; index = parents[index]; }
    return index;
  }
  if (options.level >= CLUSTER_MIN_LEVEL) points.forEach((point, index) => {
    if (!point.area) return;
    const seen = new Set<number>();
    for (let x = Math.floor(point.left / 256); x <= Math.floor(point.right / 256); x++) {
      for (let y = Math.floor(point.top / 256); y <= Math.floor(point.bottom / 256); y++) {
        const key = JSON.stringify([point.area, x, y]), bucket = buckets.get(key) || [];
        for (const other of bucket) {
          if (seen.has(other)) continue;
          seen.add(other);
          const p = points[other];
          if (point.left < p.right && point.right > p.left && point.top < p.bottom && point.bottom > p.top) parents[root(index)] = root(other);
        }
        bucket.push(index); buckets.set(key, bucket);
      }
    }
  });
  const groups = new Map<number, typeof points>();
  points.forEach((point, index) => {
    const key = root(index), group = groups.get(key) || [];
    group.push(point); groups.set(key, group);
  });
  return [...groups.values()].map((group) => ({
    key: group.map(({ place }) => place.id).join(":"),
    places: group.map(({ place }) => place),
    x: group.reduce((sum, point) => sum + point.x, 0) / group.length,
    y: group.reduce((sum, point) => sum + point.y, 0) / group.length,
    visited: group.filter(({ place }) => place.status !== "wish").length,
    region: group[0].area,
  }));
}
