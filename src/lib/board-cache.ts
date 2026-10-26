import { cacheScope, isSnapshot, SNAPSHOT_SCHEMA, type BoardSnapshot, type SyncAccess } from "./sync-types";
export interface SnapshotCache { read(access: SyncAccess): Promise<BoardSnapshot | null>; write(snapshot: BoardSnapshot): Promise<void>; clear(): Promise<void> }
/** Each operation closes its connection; unavailable/quota-limited storage is optional. */
export class DeviceBoardCache implements SnapshotCache {
  private tail: Promise<unknown> = Promise.resolve();
  private run<T>(op: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T | null> {
    const operation = this.tail.then(() => new Promise<T | null>((resolve) => {
      if (typeof indexedDB === "undefined") { resolve(null); return; }
      let db: IDBDatabase | undefined, settled = false;
      const finish = (value: T | null) => { if (!settled) { settled = true; clearTimeout(timer); db?.close(); resolve(value); } };
      const timer = setTimeout(() => finish(null), 1500);
      try {
        const open = indexedDB.open("datemap-device", 1);
        open.onupgradeneeded = () => { if (!open.result.objectStoreNames.contains("snapshots")) open.result.createObjectStore("snapshots"); };
        open.onerror = () => finish(null);
        open.onsuccess = () => {
          db = open.result; if (settled) { db.close(); return; }
          db.onversionchange = () => db?.close();
          try {
            const tx = db.transaction("snapshots", "readwrite");
            let result: T | null = null;
            tx.oncomplete = () => finish(result); tx.onabort = tx.onerror = () => finish(null);
            const request = op(tx.objectStore("snapshots"));
            if (request) request.onsuccess = () => { result = request.result; };
          } catch { finish(null); }
        };
      } catch { finish(null); }
    }));
    this.tail = operation.catch(() => null); return operation;
  }
  async read(access: SyncAccess) {
    const record = await this.run<{ schema: number; snapshot: unknown }>((store) => store.get(cacheScope(access)));
    if (record?.schema !== SNAPSHOT_SCHEMA || !isSnapshot(record.snapshot) || cacheScope(record.snapshot) !== cacheScope(access)) return null;
    return record.snapshot;
  }
  async write(snapshot: BoardSnapshot) {
    // Only the public map snapshot is persisted, never access credentials or API keys.
    const { boardId, authVersion, revision, board, places, pending, collections } = snapshot;
    await this.run((store) => store.put({ schema: SNAPSHOT_SCHEMA, snapshot: { boardId, authVersion, revision, board, places, pending, collections } }, cacheScope(snapshot)));
  }
  async clear() { await this.run((store) => store.clear()); }
}
