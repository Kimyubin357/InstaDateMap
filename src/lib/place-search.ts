import { filterPlaces, STATUS_ORDER, type PlaceView } from "./place-view";
import type { KakaoPlace } from "./types";
import { withRequestDeadline } from "./client-request";
export interface SearchState { query: string; searched: string; results: KakaoPlace[] | null; busy: boolean; error: string }
const EMPTY: SearchState = { query: "", searched: "", results: null, busy: false, error: "" };
/**
 * Saved places are searched by name, address, and memo only. Kakao's category or
 * alias matches must not expand that set. All saved IDs are still excluded from
 * new results, so a place never appears as something the couple needs to save again.
 */
export function unifiedResults(places: PlaceView[], query: string, candidates: KakaoPlace[]) {
  const ids = new Set(places.map((p) => p.kakao_place_id).filter(Boolean));
  const fresh: KakaoPlace[] = [];
  for (const place of candidates) if (!ids.has(place.kakao_place_id)) { ids.add(place.kakao_place_id); fresh.push(place); }
  return { saved: query.trim() ? filterPlaces(places, query, STATUS_ORDER, "") : [], fresh };
}
export class PlaceSearch {
  private state = EMPTY;
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private abort: AbortController | undefined;
  private sequence = 0;
  onUnauthorized = () => {};
  constructor(private fetcher: typeof fetch = (...args) => fetch(...args)) {}
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  getSnapshot = () => this.state;
  private set(patch: Partial<SearchState>) { this.state = { ...this.state, ...patch }; for (const listener of this.listeners) listener(); }
  setQuery(query: string, automatic = true) {
    this.pause(); this.set({ query, results: null, searched: "", error: "" });
    if (automatic && query.trim().length >= 2) this.timer = setTimeout(() => { void this.search(); }, 350);
  }
  pause() { clearTimeout(this.timer); this.abort?.abort(); ++this.sequence; if (this.state.busy) this.set({ busy: false }); }
  resume() { if (this.state.query.trim().length >= 2 && this.state.searched !== this.state.query.trim()) void this.search(); }
  async search() {
    this.pause(); const query = this.state.query.trim(); if (!query) return;
    const sequence = this.sequence, abort = new AbortController(); this.abort = abort;
    this.set({ busy: true, results: null, error: "" });
    try {
      const { response, body } = await withRequestDeadline(async (signal) => {
        const response = await this.fetcher(`/api/search?q=${encodeURIComponent(query)}`, { cache: "no-store", signal });
        const body = response.status === 401 || response.status === 409 ? null : await response.json();
        return { response, body };
      }, { signal: abort.signal, timeoutMs: 10000 });
      if (sequence !== this.sequence) return;
      if (response.status === 401 || response.status === 409) { this.onUnauthorized(); return; }
      if (!response.ok || !Array.isArray(body.places)) throw new Error(body?.message || "장소를 찾지 못했어요. 다시 시도해 주세요.");
      this.set({ searched: query, results: body.places });
    } catch (error) {
      if (sequence === this.sequence && !abort.signal.aborted) this.set({ error: error instanceof Error && !(error instanceof TypeError) ? error.message : "연결하지 못했어요. 저장된 장소는 계속 찾을 수 있어요." });
    } finally { if (sequence === this.sequence) this.set({ busy: false }); }
  }
}
