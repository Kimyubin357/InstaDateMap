import type { BoardStore } from "./board-store";
async function withAbort<T>(pending: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return pending;
  let onAbort!: () => void;
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
  try { return await Promise.race([pending, aborted]); }
  finally { signal.removeEventListener("abort", onAbort); }
}
export async function readSyncEvents(body: ReadableStream<Uint8Array>, receive: (event: string, data: { revision?: string }) => void, options: { signal?: AbortSignal; onActivity?: () => void } = {}) {
  const reader = body.getReader(), decoder = new TextDecoder(); let buffer = "";
  try {
    while (true) {
      const { done, value } = await withAbort(reader.read(), options.signal);
      if (options.signal?.aborted) break;
      if (value?.byteLength) options.onActivity?.();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      buffer = buffer.replace(/\r\n/g, "\n"); let end: number;
      while ((end = buffer.indexOf("\n\n")) >= 0) {
        const frame = buffer.slice(0, end); buffer = buffer.slice(end + 2);
        const event = frame.split("\n").find((line) => line.startsWith("event: "))?.slice(7);
        const data = frame.split("\n").filter((line) => line.startsWith("data: ")).map((line) => line.slice(6)).join("\n");
        if (event && data) receive(event, JSON.parse(data));
      }
      if (done) break;
    }
  } finally {
    // A broken transport may never finish cancellation. It must not hold up the next connection.
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
const STABLE_STREAM_MS = 20000;
// The server sends a heartbeat every 15s. Allow two missed beats plus some network delay.
const STREAM_IDLE_MS = 45000;
export function connectBoardSync(store: BoardStore) {
  let disposed = false, controller: AbortController | null = null, retry: ReturnType<typeof setTimeout> | undefined;
  let fallback: ReturnType<typeof setInterval> | undefined, failures = 0, run = 0;
  const visible = () => document.visibilityState !== "hidden" && navigator.onLine !== false;
  const startFallback = () => { if (!fallback) fallback = setInterval(() => { if (visible()) void store.refresh(); }, 30000); };
  const stopFallback = () => { clearInterval(fallback); fallback = undefined; };
  const open = async () => {
    if (disposed || !visible() || controller || store.isSuspended()) return;
    const sequence = ++run, abort = new AbortController(); controller = abort; let healthy = false, readyAt = 0, stalled = false;
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    const clearWatchdog = () => { clearTimeout(watchdog); watchdog = undefined; };
    const activity = () => {
      clearWatchdog();
      if (!abort.signal.aborted) watchdog = setTimeout(() => { stalled = true; abort.abort(); }, STREAM_IDLE_MS);
    };
    abort.signal.addEventListener("abort", clearWatchdog, { once: true });
    activity();
    startFallback();
    try {
      const request = fetch("/api/sync/events", { cache: "no-store", credentials: "same-origin", signal: abort.signal }).then((res) => {
        if (abort.signal.aborted) void res.body?.cancel().catch(() => {});
        return res;
      });
      const res = await withAbort(request, abort.signal);
      if (disposed || sequence !== run || abort.signal.aborted || store.isSuspended()) return;
      if (res.status === 401 || res.status === 409) { store.onUnauthorized(); return; }
      if (!res.ok || !res.body) throw new Error("sync unavailable");
      await readSyncEvents(res.body, (event, data) => {
        if (disposed || sequence !== run || abort.signal.aborted || store.isSuspended()) return;
        if (event === "expired") { abort.abort(); store.onUnauthorized(); }
        if (event === "unavailable") abort.abort();
        if (event === "ready") { healthy = true; readyAt = Date.now(); store.connected(true); stopFallback(); }
        if ((event === "ready" || event === "change") && typeof data.revision === "string" && /^\d+$/.test(data.revision)) {
          const current = store.getSnapshot().snapshot;
          if (!current || BigInt(data.revision) > BigInt(current.revision)) store.schedule();
        }
      }, { signal: abort.signal, onActivity: activity });
    } catch { /* Preserve the snapshot and use conditional requests until reconnected. */ }
    finally {
      clearWatchdog(); abort.signal.removeEventListener("abort", clearWatchdog);
      if (sequence === run) { controller = null; store.connected(false); }
      if (store.isSuspended()) stopFallback();
      if (!disposed && sequence === run && visible() && !store.isSuspended()) {
        // Reset the backoff only after the stream stayed up; a stream that drops right after "ready" keeps backing off.
        const stable = !stalled && healthy && Date.now() - readyAt >= STABLE_STREAM_MS;
        if (stable) failures = 0;
        if (stalled) void store.refresh();
        startFallback(); const delay = stable ? 300 : [1000, 2000, 5000, 10000, 30000][Math.min(failures++, 4)];
        retry = setTimeout(() => { retry = undefined; void open(); }, delay);
      }
    }
  };
  const pause = () => { ++run; controller?.abort(); controller = null; clearTimeout(retry); stopFallback(); store.connected(false); };
  const resume = () => { if (visible()) { void store.refresh(); void open(); } else pause(); };
  const offline = () => { pause(); store.offline(); };
  document.addEventListener("visibilitychange", resume); window.addEventListener("online", resume); window.addEventListener("offline", offline);
  void open();
  return () => { disposed = true; pause(); document.removeEventListener("visibilitychange", resume); window.removeEventListener("online", resume); window.removeEventListener("offline", offline); };
}
