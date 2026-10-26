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
it("연결 직후 바로 끊기는 스트림은 재연결 간격을 늘리고, 오래 유지된 뒤 끊기면 바로 재연결", async () => {
  const encoder = new TextEncoder();
  const flapping = vi.fn(async () => new Response('event: ready\ndata: {"revision":"3"}\n\nevent: unavailable\ndata: {}\n\n'));
  const { stop } = setup(flapping as unknown as typeof fetch);
  await vi.advanceTimersByTimeAsync(10000);
  expect(flapping.mock.calls.length).toBeLessThanOrEqual(4); // 0s, +1s, +2s, +5s instead of every 300ms
  stop();
  const stable = vi.fn(async (_url: unknown, init?: RequestInit) => new Response(new ReadableStream({ start(c) {
    c.enqueue(encoder.encode('event: ready\ndata: {"revision":"3"}\n\n'));
    const t = setTimeout(() => c.close(), 25000);
    init?.signal?.addEventListener("abort", () => { clearTimeout(t); c.close(); }, { once: true });
  } })));
  const second = setup(stable as unknown as typeof fetch);
  await vi.advanceTimersByTimeAsync(25000); expect(stable).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(400); expect(stable).toHaveBeenCalledTimes(2);
  second.stop();
});

it("ready 뒤 스트림과 취소가 멈춰도 45초 후 목록을 재확인하고 새 연결로 복구", async () => {
  const encoder = new TextEncoder();
  const cancel = vi.fn(() => new Promise<void>(() => {}));
  const fetcher = vi.fn()
    .mockResolvedValueOnce(new Response(new ReadableStream({ start(c) {
      c.enqueue(encoder.encode('event: ready\ndata: {"revision":"3"}\n\n'));
    }, cancel })))
    .mockImplementation(async () => new Response(new ReadableStream({ start(c) {
      c.enqueue(encoder.encode('event: ready\ndata: {"revision":"4"}\n\n'));
    } })));
  const { store, stop } = setup(fetcher as typeof fetch);
  try {
    await vi.advanceTimersByTimeAsync(44000);
    expect(store.connected).toHaveBeenLastCalledWith(true); expect(store.refresh).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(store.connected).toHaveBeenLastCalledWith(false); expect(store.refresh).toHaveBeenCalledOnce(); expect(cancel).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetcher).toHaveBeenCalledTimes(2); expect(store.connected).toHaveBeenLastCalledWith(true); expect(store.schedule).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(30000);
    expect(store.refresh).toHaveBeenCalledOnce();
  } finally { stop(); }
  await vi.advanceTimersByTimeAsync(0); expect(vi.getTimerCount()).toBe(0);
});

it("응답 헤더가 멈춰도 재연결하고 중단한 요청의 늦은 인증 오류는 무시", async () => {
  let resolve!: (response: Response) => void;
  const pending = new Promise<Response>((done) => { resolve = done; });
  const fetcher = vi.fn().mockReturnValueOnce(pending).mockResolvedValue(new Response(new ReadableStream({ start(c) {
    c.enqueue(new TextEncoder().encode('event: ready\ndata: {"revision":"3"}\n\n'));
  } })));
  const { store, stop } = setup(fetcher as typeof fetch);
  try {
    await vi.advanceTimersByTimeAsync(45000);
    expect((fetcher.mock.calls[0][1] as RequestInit).signal?.aborted).toBe(true);
    expect(store.refresh).toHaveBeenCalledTimes(2); // 30초 대체 조회 + 멈춤 감지 직후 조회
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetcher).toHaveBeenCalledTimes(2); expect(store.connected).toHaveBeenLastCalledWith(true);
    resolve(new Response(null, { status: 401 })); await vi.advanceTimersByTimeAsync(0);
    expect(store.onUnauthorized).not.toHaveBeenCalled(); expect(store.connected).toHaveBeenLastCalledWith(true);
  } finally { stop(); }
  await vi.advanceTimersByTimeAsync(0); expect(vi.getTimerCount()).toBe(0);
});

it("heartbeat 이벤트와 SSE 주석은 연결을 유지하며 불필요한 목록 조회를 만들지 않음", async () => {
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  const encoder = new TextEncoder();
  const fetcher = vi.fn(async () => new Response(new ReadableStream({ start(c) {
    stream = c; c.enqueue(encoder.encode('event: ready\ndata: {"revision":"3"}\n\n'));
  } })));
  const { store, stop } = setup(fetcher as typeof fetch);
  try {
    for (let beat = 0; beat < 8; beat++) {
      await vi.advanceTimersByTimeAsync(15000);
      stream.enqueue(encoder.encode(beat % 2 ? 'event: heartbeat\ndata: {}\n\n' : ': keepalive\n\n'));
      await vi.advanceTimersByTimeAsync(0);
    }
    expect(fetcher).toHaveBeenCalledOnce(); expect(store.refresh).not.toHaveBeenCalled(); expect(store.schedule).not.toHaveBeenCalled();
    expect(store.connected).toHaveBeenLastCalledWith(true);
  } finally { stop(); }
  await vi.advanceTimersByTimeAsync(0); expect(vi.getTimerCount()).toBe(0);
});

it("45초마다 조용히 멈추는 연결도 재시도 간격을 계속 늘림", async () => {
  const openedAt: number[] = [];
  const fetcher = vi.fn(async () => {
    openedAt.push(Date.now());
    return new Response(new ReadableStream({ start(c) {
      c.enqueue(new TextEncoder().encode('event: ready\ndata: {"revision":"3"}\n\n'));
    } }));
  });
  const { stop } = setup(fetcher as typeof fetch);
  try {
    await vi.advanceTimersByTimeAsync(143000);
    expect(openedAt.map((time) => time - openedAt[0])).toEqual([0, 46000, 93000, 143000]);
  } finally { stop(); }
  await vi.advanceTimersByTimeAsync(0); expect(vi.getTimerCount()).toBe(0);
});

it.each(["hidden", "offline", "dispose"])("%s 전환은 watchdog과 대체 조회를 정리하고 늦은 본문 이벤트를 무시", async (reason) => {
  let resolve!: (result: ReadableStreamReadResult<Uint8Array>) => void;
  const pending = new Promise<ReadableStreamReadResult<Uint8Array>>((done) => { resolve = done; });
  const reader = { read: vi.fn(() => pending), cancel: vi.fn(() => new Promise<void>(() => {})), releaseLock: vi.fn() };
  const fetcher = vi.fn(async () => ({ ok: true, status: 200, body: { getReader: () => reader } }) as unknown as Response);
  const { store, doc, win, stop } = setup(fetcher as typeof fetch);
  await vi.advanceTimersByTimeAsync(0);
  if (reason === "hidden") { doc.visibilityState = "hidden"; doc.dispatchEvent(new Event("visibilitychange")); }
  else if (reason === "offline") { vi.stubGlobal("navigator", { onLine: false }); win.dispatchEvent(new Event("offline")); }
  else stop();
  await vi.advanceTimersByTimeAsync(0);
  expect(vi.getTimerCount()).toBe(0); expect(reader.cancel).toHaveBeenCalledOnce(); expect(reader.releaseLock).toHaveBeenCalledOnce();
  resolve({ done: false, value: new TextEncoder().encode('event: change\ndata: {"revision":"99"}\n\n') });
  await vi.advanceTimersByTimeAsync(90000);
  expect(store.schedule).not.toHaveBeenCalled(); expect(store.refresh).not.toHaveBeenCalled(); expect(fetcher).toHaveBeenCalledOnce(); stop();
});
