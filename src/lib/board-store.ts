import { DeviceBoardCache, type SnapshotCache } from "./board-cache";
import { cacheScope, isSnapshot, snapshotEtag, type BoardSnapshot, type SyncAccess } from "./sync-types";
import type { PlaceView } from "./place-view";
import { clearRecentSearches } from "./recent-searches";
import type { SavedPlace } from "./saved-place";
export interface BoardState { access: SyncAccess | null; snapshot: BoardSnapshot | null; syncing: boolean; error: string; connected: boolean }
export const EMPTY_BOARD_STATE: BoardState = { access: null, snapshot: null, syncing: false, error: "", connected: false };
export class BoardStore {
  private state = EMPTY_BOARD_STATE;
  private listeners = new Set<() => void>();
  private generation = 0; private mutation = 0; private dirty = false; private flight: Promise<void> | null = null;
  private abort: AbortController | null = null; private debounce: ReturnType<typeof setTimeout> | undefined;
  private paused = false;
  private confirmedRevision = "0";
  onUnauthorized: () => void = () => {};
  constructor(private cache: SnapshotCache = new DeviceBoardCache(), private fetcher: typeof fetch = (...args) => fetch(...args)) {}
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  getSnapshot = () => this.state;
  private set(patch: Partial<BoardState>) { this.state = { ...this.state, ...patch }; for (const listener of this.listeners) listener(); }
  async authorize(access: SyncAccess) {
    // A cached Next.js route must not restore an access version from before PIN rotation.
    if (this.state.access?.boardId === access.boardId && this.state.access.authVersion > access.authVersion) return;
    if (new Date(access.expiresAt).getTime() <= Date.now()) { this.onUnauthorized(); return; }
    this.paused = false;
    if (this.state.access && cacheScope(this.state.access) === cacheScope(access)) {
      if (this.state.access.who !== access.who || this.state.access.expiresAt !== access.expiresAt) this.set({ access });
      return;
    }
    this.cancel(); const generation = ++this.generation;
    this.confirmedRevision = "0";
    this.set({ ...EMPTY_BOARD_STATE, access });
    const cached = await this.cache.read(access).catch(() => null);
    if (generation !== this.generation) return;
    if (cached && isSnapshot(cached) && cacheScope(cached) === cacheScope(access)) this.set({ snapshot: cached });
    void this.refresh();
  }
  connected(value: boolean) { if (this.state.connected !== value) this.set({ connected: value }); }
  offline() { this.set({ error: "오프라인이에요.", connected: false }); }
  invalidate() { this.mutation++; this.schedule(); }
  schedule() {
    clearTimeout(this.debounce);
    this.debounce = setTimeout(() => { void this.refresh(); }, 250);
  }
  refresh = (): Promise<void> => {
    clearTimeout(this.debounce);
    if (!this.state.access || this.paused) return Promise.resolve();
    this.dirty = true;
    if (this.flight) return this.flight;
    const generation = this.generation;
    const task = Promise.resolve().then(() => this.load(generation));
    this.flight = task;
    void task.finally(() => { if (this.flight === task) this.flight = null; });
    return task;
  };
  private async load(generation: number) {
    this.set({ syncing: true });
    while (this.dirty && generation === this.generation && !this.paused) {
      this.dirty = false; const mutation = this.mutation; const access = this.state.access!;
      const headers: Record<string, string> = {};
      if (this.state.snapshot) headers["If-None-Match"] = snapshotEtag(this.state.snapshot);
      const abort = new AbortController(); this.abort = abort;
      try {
        const res = await this.fetcher("/api/places", { cache: "no-store", credentials: "same-origin", headers, signal: abort.signal });
        if (generation !== this.generation || abort.signal.aborted) return;
        if (res.status === 401 || res.status === 409) { this.onUnauthorized(); return; }
        if (mutation !== this.mutation) { this.dirty = true; continue; }
        if (res.status === 304) { this.set({ error: "" }); continue; }
        const data: unknown = await res.json();
        if (generation !== this.generation || abort.signal.aborted) return;
        if (mutation !== this.mutation) { this.dirty = true; continue; }
        if (!res.ok) throw new Error((data as { message?: string })?.message || "변경 내용을 확인하지 못했어요.");
        if (!isSnapshot(data) || cacheScope(data) !== cacheScope(access)) throw new Error("장소 응답을 확인하지 못했어요.");
        const previous = this.state.snapshot;
        if (previous && BigInt(data.revision) < BigInt(previous.revision)) throw new Error("서버의 변경 순서를 다시 확인해야 해요. 기존 내용을 유지할게요.");
        if (BigInt(data.revision) < BigInt(this.confirmedRevision)) throw new Error("저장 결과를 맞추는 중이에요. 저장한 장소는 그대로 보여드려요.");
        this.set({ snapshot: data, error: "" }); this.persist(data, generation);
      } catch (e) {
        if (generation === this.generation && !abort.signal.aborted) this.set({ error: e instanceof Error && !(e instanceof TypeError) ? e.message : "연결이 끊겼어요. 마지막으로 저장된 내용을 보여드려요." });
      }
    }
    if (generation === this.generation) this.set({ syncing: false });
  }
  private persist(snapshot: BoardSnapshot, generation = this.generation) {
    if (generation === this.generation && !this.paused) void this.cache.write(snapshot).catch(() => {});
  }
  acceptSavedPlace(saved?: SavedPlace) {
    const { access, snapshot } = this.state;
    if (!saved || this.paused || !access || !snapshot || cacheScope(saved) !== cacheScope(access) ||
      !/^\d+$/.test(saved.revision) || BigInt(saved.revision) < BigInt(snapshot.revision) || BigInt(saved.revision) < BigInt(this.confirmedRevision) ||
      !isSnapshot({ ...snapshot, places: [saved.place] })) return false;
    this.mutation++;
    this.confirmedRevision = saved.revision;
    // Do not advance the full-list ETag with a partial update: other changes still need fetching.
    const next = { ...snapshot, places: [saved.place, ...snapshot.places.filter((p) => p.id !== saved.place.id)] };
    this.set({ snapshot: next, error: "" }); this.persist(next); this.schedule();
    return true;
  }
  patchPlace(id: string, patch: Partial<Pick<PlaceView, "status" | "memo">>) {
    this.mutation++;
    if (this.state.snapshot) { const snapshot = { ...this.state.snapshot, places: this.state.snapshot.places.map((p) => p.id === id ? { ...p, ...patch } : p) }; this.set({ snapshot }); this.persist(snapshot); }
    this.schedule();
  }
  removePlace(id: string) {
    this.mutation++;
    if (this.state.snapshot) { const snapshot = { ...this.state.snapshot, places: this.state.snapshot.places.filter((p) => p.id !== id) }; this.set({ snapshot }); this.persist(snapshot); }
    this.schedule();
  }
  isSuspended() { return this.paused; }
  suspend() { ++this.generation; this.paused = true; this.cancel(); this.set({ connected: false, syncing: false }); }
  resume() { this.paused = false; void this.refresh(); }
  private cancel() { clearTimeout(this.debounce); this.abort?.abort(); this.flight = null; this.dirty = false; }
  async forget() { ++this.generation; this.paused = true; this.cancel(); clearRecentSearches(); this.set(EMPTY_BOARD_STATE); await this.cache.clear().catch(() => {}); }
}
