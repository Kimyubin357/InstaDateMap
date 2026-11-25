import { withRequestDeadline } from "./client-request";
import { pruneSeen, readSeenLog, writeSeenLog, type SeenLog } from "./new-places";
import { readScope, writeScope, type AllPlace, type AllPlacesResponse, type RoomSummary, type RoomsResponse, type Scope } from "./rooms";
import type { PlaceView } from "./place-view";

/**
 * 방 고르기·전체 보기의 기기 상태(2026-11-25).
 * - 범위(scope): 전체 / 이 기기가 연 방. 이 기기에 기억합니다.
 * - 방 목록(/api/rooms): 방 버튼 색·내 방 시트·리스트 [방] 칸.
 * - 전체 장소(/api/places/all): 전체일 때만 받습니다. 열린 방은 실시간 동기화(BoardStore)가 맡고,
 *   전체는 화면으로 돌아올 때·변경 알림·30초마다 조건부 요청(ETag)으로 맞춥니다.
 * - 본 장소(NEW): 서버 기록(020) + 이 기기 기록.
 */
export interface RoomsState {
  userId: string | null; scope: Scope;
  rooms: RoomSummary[] | null; current: string | null; roomsError: string;
  all: AllPlace[] | null; allError: string; allLoading: boolean;
  seen: ReadonlySet<string>;
}
export const EMPTY_ROOMS_STATE: RoomsState = { userId: null, scope: "all", rooms: null, current: null, roomsError: "", all: null, allError: "", allLoading: false, seen: new Set() };

type Fetcher = typeof fetch;
const json = async <T,>(fetcher: Fetcher, url: string, init: RequestInit = {}) => withRequestDeadline(async (signal) => {
  const res = await fetcher(url, { cache: "no-store", credentials: "same-origin", ...init, signal });
  const body = res.status === 304 ? null : await res.json().catch(() => null);
  return { res, body: body as T | null };
}, { timeoutMs: 20000 });

export class RoomsStore {
  private state = EMPTY_ROOMS_STATE;
  private listeners = new Set<() => void>();
  private etag = ""; private generation = 0; private timer: ReturnType<typeof setTimeout> | undefined;
  private allFlight: Promise<void> | null = null; private allAgain = false;
  private log: SeenLog = {}; private serverSeen = new Set<string>();
  constructor(private fetcher: Fetcher = (...args) => fetch(...args)) {}
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  getSnapshot = () => this.state;
  private set(patch: Partial<RoomsState>) { this.state = { ...this.state, ...patch }; for (const fn of this.listeners) fn(); }

  /** 로그인한 계정이 정해지거나 바뀔 때. 같은 계정이면 방 목록만 새로 받습니다(방을 바꾼 뒤 등). */
  bind(userId: string | null | undefined) {
    if (!userId) { this.forget(); return; }
    if (this.state.userId !== userId) {
      ++this.generation; this.etag = ""; this.serverSeen = new Set();
      this.log = readSeenLog(userId);
      this.state = { ...EMPTY_ROOMS_STATE, userId, scope: readScope(userId), seen: new Set(Object.keys(this.log)) };
      for (const fn of this.listeners) fn();
      void this.loadSeen();
    }
    void this.loadRooms();
    if (this.state.scope === "all") void this.loadAll();
  }
  forget() { ++this.generation; clearTimeout(this.timer); this.etag = ""; this.log = {}; this.serverSeen = new Set(); this.set({ ...EMPTY_ROOMS_STATE }); }
  setScope(scope: Scope) {
    writeScope(this.state.userId, scope);
    if (scope !== this.state.scope) this.set({ scope });
    if (scope === "all") void this.loadAll();
  }
  /** 장소가 바뀌었을 수 있을 때(저장·수정·삭제·다른 기기의 변경·화면 복귀). 몰려와도 한 번만 받습니다. */
  schedule(delay = 400) {
    if (!this.state.userId) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { void this.loadRooms(); if (this.state.scope === "all") void this.loadAll(); }, delay);
  }
  async loadRooms() {
    const generation = this.generation;
    try {
      const { res, body } = await json<RoomsResponse>(this.fetcher, "/api/rooms");
      if (generation !== this.generation) return;
      if (!res.ok || !body || !Array.isArray(body.rooms)) throw new Error("방 목록을 불러오지 못했어요.");
      this.set({ rooms: body.rooms, current: body.current ?? null, roomsError: "" });
    } catch (e) {
      if (generation === this.generation) this.set({ roomsError: e instanceof Error && /[가-힣]/.test(e.message) ? e.message : "방 목록을 불러오지 못했어요." });
    }
  }
  loadAll(): Promise<void> {
    if (!this.state.userId) return Promise.resolve();
    if (this.allFlight) { this.allAgain = true; return this.allFlight; }
    const task = (async () => {
      do {
        this.allAgain = false;
        const generation = this.generation;
        this.set({ allLoading: true });
        try {
          const { res, body } = await json<AllPlacesResponse>(this.fetcher, "/api/places/all", { headers: this.etag && this.state.all ? { "If-None-Match": this.etag } : {} });
          if (generation !== this.generation) return;
          if (res.status === 304) { this.set({ allError: "", allLoading: false }); continue; }
          if (!res.ok || !body || !Array.isArray(body.places) || !Array.isArray(body.rooms)) throw new Error("모든 방의 장소를 불러오지 못했어요.");
          this.etag = res.headers.get("etag") || "";
          this.set({ all: body.places, rooms: body.rooms, current: body.current ?? null, allError: "", allLoading: false });
        } catch (e) {
          if (generation === this.generation) this.set({ allLoading: false, allError: e instanceof Error && /[가-힣]/.test(e.message) ? e.message : "연결이 끊겼어요. 마지막으로 받은 내용을 보여드려요." });
        }
      } while (this.allAgain);
    })();
    this.allFlight = task;
    void task.finally(() => { if (this.allFlight === task) this.allFlight = null; });
    return task;
  }
  private async loadSeen() {
    const generation = this.generation;
    try {
      const { res, body } = await json<{ ids: string[] }>(this.fetcher, "/api/places/seen");
      if (generation !== this.generation || !res.ok || !Array.isArray(body?.ids)) return;
      this.serverSeen = new Set(body.ids);
      this.set({ seen: new Set([...this.serverSeen, ...Object.keys(this.log)]) });
    } catch { /* 이 기기 기록만으로 계속합니다. */ }
  }
  /** 장소 카드·상세를 열었을 때, "모두 본 걸로 하기". 화면에서는 바로 빼고, 서버에는 조용히 적습니다. */
  markSeen(ids: readonly string[]) {
    const userId = this.state.userId;
    const fresh = [...new Set(ids)].filter((id) => !this.state.seen.has(id));
    if (!userId || !fresh.length) return;
    const now = Date.now();
    this.log = pruneSeen({ ...this.log, ...Object.fromEntries(fresh.map((id) => [id, now])) }, now);
    writeSeenLog(userId, this.log);
    this.set({ seen: new Set([...this.state.seen, ...fresh]) });
    for (let i = 0; i < fresh.length; i += 500) {
      void json(this.fetcher, "/api/places/seen", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: fresh.slice(i, i + 500) }) })
        .catch(() => { /* 다음에 열 때 이 기기 기록으로 다시 사라집니다. */ });
    }
  }
  /** 전체 보기에서 다른 방 장소를 고치거나 지웠을 때 바로 보이게 합니다(서버 확인은 다음 조회). */
  patchPlace(id: string, patch: Partial<Pick<PlaceView, "status" | "memo" | "memo_version">>) {
    if (this.state.all) this.set({ all: this.state.all.map((p) => p.id === id ? { ...p, ...patch } : p) });
    this.schedule();
  }
  removePlace(id: string) {
    if (this.state.all) this.set({ all: this.state.all.filter((p) => p.id !== id) });
    this.schedule();
  }
}
