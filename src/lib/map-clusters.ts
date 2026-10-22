import type { PlaceStatus } from "./types";

export const CLUSTER_MIN_LEVEL = 6;
export const CLUSTER_RADIUS = 80;
export interface ClusterPlace { id: string; status: PlaceStatus }
export interface ScreenPoint { x: number; y: number }
export interface PlaceCluster<T extends ClusterPlace> extends ScreenPoint {
  key: string;
  places: T[];
  visited: number;
}

/** Screen-distance components stay the same when the map pans or input order changes. */
export function clusterPlaces<T extends ClusterPlace>(places: readonly T[], project: (place: T) => ScreenPoint, radius = CLUSTER_RADIUS): PlaceCluster<T>[] {
  const unique = [...new Map(places.map((place) => [place.id, place])).values()].sort((a, b) => a.id.localeCompare(b.id));
  const points = unique.map((place) => ({ place, ...project(place) })).filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
  const size = Math.max(1, radius), squared = size * size;
  const parents = points.map((_, index) => index);
  const buckets = new Map<string, number[]>();
  function root(index: number): number {
    while (parents[index] !== index) { parents[index] = parents[parents[index]]; index = parents[index]; }
    return index;
  }
  points.forEach((point, index) => {
    const col = Math.floor(point.x / size), row = Math.floor(point.y / size);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      for (const other of buckets.get(`${col + dx}:${row + dy}`) || []) {
        const a = root(index), b = root(other);
        if (a !== b && (point.x - points[other].x) ** 2 + (point.y - points[other].y) ** 2 <= squared) parents[a] = b;
      }
    }
    const key = `${col}:${row}`, bucket = buckets.get(key) || [];
    bucket.push(index); buckets.set(key, bucket);
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
  }));
}
