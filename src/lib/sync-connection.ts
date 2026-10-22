import type { BoardStore } from "./board-store";
export async function readSyncEvents(body: ReadableStream<Uint8Array>, receive: (event: string, data: { revision?: string }) => void) {
  const reader = body.getReader(), decoder = new TextDecoder(); let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read(); buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      buffer = buffer.replace(/\r\n/g, "\n"); let end: number;
      while ((end = buffer.indexOf("\n\n")) >= 0) {
        const frame = buffer.slice(0, end); buffer = buffer.slice(end + 2);
        const event = frame.split("\n").find((line) => line.startsWith("event: "))?.slice(7);
        const data = frame.split("\n").filter((line) => line.startsWith("data: ")).map((line) => line.slice(6)).join("\n");
        if (event && data) receive(event, JSON.parse(data));
      }
      if (done) break;
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
export function connectBoardSync(store: BoardStore) {
  let disposed = false, controller: AbortController | null = null, retry: ReturnType<typeof setTimeout> | undefined;
  let fallback: ReturnType<typeof setInterval> | undefined, failures = 0, run = 0;
  const visible = () => document.visibilityState !== "hidden" && navigator.onLine !== false;
  const startFallback = () => { if (!fallback) fallback = setInterval(() => { if (visible()) void store.refresh(); }, 30000); };
  const stopFallback = () => { clearInterval(fallback); fallback = undefined; };
  const open = async () => {
    if (disposed || !visible() || controller || store.isSuspended()) return;
    const sequence = ++run, abort = new AbortController(); controller = abort; let healthy = false;
    startFallback();
    try {
      const res = await fetch("/api/sync/events", { cache: "no-store", credentials: "same-origin", signal: abort.signal });
      if (disposed || sequence !== run || abort.signal.aborted || store.isSuspended()) return;
      if (res.status === 401 || res.status === 409) { store.onUnauthorized(); return; }
      if (!res.ok || !res.body) throw new Error("sync unavailable");
      await readSyncEvents(res.body, (event, data) => {
        if (disposed || sequence !== run || abort.signal.aborted || store.isSuspended()) return;
        if (event === "expired") { abort.abort(); store.onUnauthorized(); }
        if (event === "unavailable") abort.abort();
        if (event === "ready") { healthy = true; failures = 0; store.connected(true); stopFallback(); }
        if ((event === "ready" || event === "change") && typeof data.revision === "string" && /^\d+$/.test(data.revision)) {
          const current = store.getSnapshot().snapshot;
          if (!current || BigInt(data.revision) > BigInt(current.revision)) store.schedule();
        }
      });
    } catch { /* Preserve the snapshot and use conditional requests until reconnected. */ }
    finally {
      if (sequence === run) { controller = null; store.connected(false); }
      if (store.isSuspended()) stopFallback();
      if (!disposed && sequence === run && visible() && !store.isSuspended()) {
        startFallback(); const delay = healthy ? 300 : [1000, 2000, 5000, 10000, 30000][Math.min(failures++, 4)];
        retry = setTimeout(() => { void open(); }, delay);
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
