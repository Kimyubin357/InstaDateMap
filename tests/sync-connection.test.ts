import { afterEach, expect, it, vi } from "vitest";
import { connectBoardSync } from "@/lib/sync-connection";
import type { BoardStore } from "@/lib/board-store";
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
function setup(fetcher: typeof fetch) {
  vi.useFakeTimers(); const doc = Object.assign(new EventTarget(), { visibilityState: "visible" }); const win = new EventTarget();
  vi.stubGlobal("document", doc); vi.stubGlobal("window", win); vi.stubGlobal("navigator", { onLine: true }); vi.stubGlobal("fetch", fetcher);
  const store = { refresh: vi.fn(async () => {}), connected: vi.fn(), schedule: vi.fn(), offline: vi.fn(), isSuspended: () => false, onUnauthorized: vi.fn(), getSnapshot: () => ({ snapshot: { revision: "3" } }) };
  return { store, doc, win, stop: connectBoardSync(store as unknown as BoardStore) };
}
it("실시간 장애 중에만 30초 조건부 조회하고 숨겨지면 타이머 중단", async () => {
  const { store, doc, stop } = setup(vi.fn(async () => { throw new TypeError("disconnected"); }) as typeof fetch);
  await vi.advanceTimersByTimeAsync(30000); expect(store.refresh).toHaveBeenCalledOnce();
  doc.visibilityState = "hidden"; doc.dispatchEvent(new Event("visibilitychange")); const before = store.refresh.mock.calls.length;
  await vi.advanceTimersByTimeAsync(60000); expect(store.refresh).toHaveBeenCalledTimes(before); stop(); expect(vi.getTimerCount()).toBe(0);
});
it("연결 복구 시 변경 번호를 확인하고 같은 번호면 목록 재요청 없이 폴링 종료", async () => {
  const encoder = new TextEncoder();
  const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => new Response(new ReadableStream({ start(c) {
    c.enqueue(encoder.encode('event: ready\ndata: {"revision":"3"}\n\n'));
    init?.signal?.addEventListener("abort", () => c.close(), { once: true });
  } })));
  const { store, stop } = setup(fetcher as typeof fetch);
  await vi.advanceTimersByTimeAsync(30000); expect(store.connected).toHaveBeenCalledWith(true); expect(store.refresh).not.toHaveBeenCalled(); expect(store.schedule).not.toHaveBeenCalled();
  stop(); await Promise.resolve(); expect(vi.getTimerCount()).toBe(0);
});
it("알림의 더 높은 변경 번호만 반영하고 권한 만료 시 캐시 제거 경로로 전달", async () => {
  const encoder = new TextEncoder();
  const { store, stop } = setup(vi.fn(async () => new Response('event: change\ndata: {"revision":"2"}\n\nevent: change\ndata: {"revision":"4"}\n\nevent: expired\ndata: {}\n\n')) as typeof fetch);
  await vi.advanceTimersByTimeAsync(0); expect(store.schedule).toHaveBeenCalledOnce(); expect(store.onUnauthorized).toHaveBeenCalledOnce(); stop();
});
it("PIN 재인증을 위해 중단한 이전 연결의 늦은 401은 기기를 잠그지 않음", async () => {
  let resolve!: (response: Response) => void;
  const pending = new Promise<Response>((done) => { resolve = done; });
  const { store, stop } = setup(vi.fn(() => pending) as typeof fetch);
  store.isSuspended = () => true; resolve(new Response(null, { status: 401 }));
  await vi.advanceTimersByTimeAsync(0); expect(store.onUnauthorized).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0); stop();
});
