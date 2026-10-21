import { cacheScope, type SyncAccess } from "./sync-types";
const PREFIX = "datemap-search-v1:";
type Storage = Pick<globalThis.Storage, "getItem" | "setItem" | "removeItem">;
function deviceStorage() { try { return globalThis.localStorage; } catch { return undefined; } }
const normalize = (query: string) => query.trim().replace(/\s+/g, " ").slice(0, 100);
/** Device-only queries; map/search results and credentials never enter this record. */
export class RecentSearches {
  private items: string[] = [];
  private key: string;
  constructor(access: Pick<SyncAccess, "boardId" | "authVersion">, private storage: Storage | undefined = deviceStorage()) {
    this.key = PREFIX + cacheScope(access);
    try {
      const value: unknown = JSON.parse(storage?.getItem(this.key) || "null");
      if (Array.isArray(value) && value.every((q) => typeof q === "string" && q === normalize(q) && !!q)) this.items = [...new Set(value)].slice(0, 20);
    } catch { /* A malformed/unavailable device record is optional. */ }
  }
  read() { return [...this.items]; }
  add(query: string) {
    const term = normalize(query); if (!term) return this.read();
    this.items = [term, ...this.items.filter((q) => q.toLocaleLowerCase() !== term.toLocaleLowerCase())].slice(0, 20);
    return this.persist();
  }
  remove(query: string) { this.items = this.items.filter((q) => q !== query); return this.persist(); }
  clear() { this.items = []; try { this.storage?.removeItem(this.key); } catch {} return this.read(); }
  private persist() { try { this.storage?.setItem(this.key, JSON.stringify(this.items)); } catch {} return this.read(); }
}
export function clearRecentSearches() {
  try {
    const storage = deviceStorage(); if (!storage) return;
    const keys = Array.from({ length: storage.length }, (_, i) => storage.key(i)).filter((key): key is string => !!key?.startsWith(PREFIX));
    for (const key of keys) storage.removeItem(key);
  } catch { /* Storage denial must not prevent locking the device. */ }
}
