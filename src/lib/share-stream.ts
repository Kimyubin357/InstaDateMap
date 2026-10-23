import { ConnectionError, RequestError, withRequestDeadline } from "./client-request";
import type { SavedPlace } from "./saved-place";
export interface ShareResult { status: string; code?: string; message: string; confirm_url?: string; source_id?: string; source_version?: string; place_url?: string; saved_place?: SavedPlace }
export function requestShare(body: unknown, progress: (stage: string) => void): Promise<ShareResult> {
  return withRequestDeadline(async (signal) => {
    try {
      const response = await fetch("/api/share", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
      return await readShareResponse(response, (stage) => { if (!signal.aborted) progress(stage); }, signal);
    } catch (error) { if (signal.aborted) throw signal.reason; if (error instanceof RequestError) throw error; throw new ConnectionError(error instanceof Error ? error.message : undefined); }
  }, { timeoutMs: 65000 });
}
export async function readShareResponse(res: Response, progress: (stage: string) => void, signal?: AbortSignal): Promise<ShareResult> {
  if (signal?.aborted) { void res.body?.cancel(signal.reason).catch(() => {}); throw signal.reason; }
  if (!res.ok || !res.headers.get("content-type")?.includes("application/x-ndjson")) {
    const body = await res.json();
    if (signal?.aborted) throw signal.reason;
    if (!res.ok) throw new RequestError(body.message || "링크를 처리하지 못했어요.", res.status);
    return body;
  }
  if (!res.body) throw new Error("처리 결과를 읽지 못했어요.");
  const reader = res.body.getReader(); const decoder = new TextDecoder(); let buffer = ""; let result: ShareResult | undefined;
  const cancel = () => { void reader.cancel(signal?.reason).catch(() => {}); };
  signal?.addEventListener("abort", cancel, { once: true });
  const consume = (line: string) => { if (!line.trim()) return; const data = JSON.parse(line); if (data.type === "progress") progress(data.stage); if (data.type === "result") result = data.result; };
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (signal?.aborted) throw signal.reason;
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      const lines = buffer.split("\n"); buffer = lines.pop() || "";
      for (const line of lines) {
        consume(line);
        // The result event is final; a transport that stalls before EOF must not delay success.
        if (result) return result;
      }
      if (done) break;
    }
    consume(buffer);
  } finally { signal?.removeEventListener("abort", cancel); cancel(); reader.releaseLock(); }
  if (!result) throw new ConnectionError("연결이 끊겼어요. 지도에서 저장 결과를 확인하거나 다시 시도해 주세요.");
  return result;
}
