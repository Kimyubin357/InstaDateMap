export interface MapRegion { district: string; local: string | null }
export interface RegionDocument {
  region_type: string; region_1depth_name: string; region_2depth_name: string;
  region_3depth_name: string;
}
export interface RegionPoint { lat: number; lng: number }
export const regionPointKey = (p: RegionPoint) => `${p.lng}:${p.lat}`;

/** H is the administrative neighborhood; B is a different (legal-address) boundary. */
export function administrativeRegion(documents: RegionDocument[]): MapRegion | null {
  const d = documents.find((d) => d.region_type === "H");
  if (!d?.region_1depth_name?.trim()) return null;
  const district = [d.region_1depth_name, d.region_2depth_name].filter(Boolean).join(" ");
  // Sejong has no district name. Its province-level city still forms a unique key.
  if (!d.region_2depth_name && d.region_1depth_name !== "세종특별자치시") return null;
  return { district, local: d.region_3depth_name ? `${district} ${d.region_3depth_name}` : null };
}

/** Kept with the mounted map, never in the place cache or authentication storage. */
export class MapRegionCache {
  private entries = new Map<string, { value: MapRegion | null; expires: number }>();
  private pending = new Map<string, Promise<MapRegion | null>>();
  get(point: RegionPoint): MapRegion | null | undefined {
    const entry = this.entries.get(regionPointKey(point));
    return entry && entry.expires > Date.now() ? entry.value : undefined;
  }
  async resolve(point: RegionPoint, lookup: (p: RegionPoint) => Promise<MapRegion | null>): Promise<MapRegion | null> {
    const key = regionPointKey(point), cached = this.get(point);
    if (cached !== undefined) return cached;
    const running = this.pending.get(key);
    if (running) return running;
    const promise = Promise.resolve().then(() => lookup(point)).catch(() => null).then((value) => {
      this.entries.set(key, { value, expires: Date.now() + (value ? 24 * 60 * 60_000 : 60_000) });
      this.pending.delete(key);
      if (this.entries.size > 2000) this.entries.delete(this.entries.keys().next().value!);
      return value;
    });
    this.pending.set(key, promise);
    return promise;
  }
}
