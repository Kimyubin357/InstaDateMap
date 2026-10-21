import { RequestError } from "./client-request";
export interface ShareResult { status: string; message: string; confirm_url?: string; source_id?: string; place_url?: string }
export async function readShareResponse(res: Response, progress: (stage: string) => void): Promise<ShareResult> {
  if (!res.ok || !res.headers.get("content-type")?.includes("application/x-ndjson")) {
    const body = await res.json();
    if (!res.ok) throw new RequestError(body.message || "링크를 처리하지 못했어요.", res.status);
    return body;
  }
  if (!res.body) throw new Error("처리 결과를 읽지 못했어요.");
  const reader = res.body.getReader(); const decoder = new TextDecoder(); let buffer = ""; let result: ShareResult | undefined;
  const consume = (line: string) => { if (!line.trim()) return; const data = JSON.parse(line); if (data.type === "progress") progress(data.stage); if (data.type === "result") result = data.result; };
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      const lines = buffer.split("\n"); buffer = lines.pop() || ""; lines.forEach(consume);
      if (done) break;
    }
    consume(buffer);
  } finally { reader.releaseLock(); }
  if (!result) throw new Error("연결이 끊겼어요. 지도에서 저장 결과를 확인하거나 다시 시도해 주세요.");
  return result;
}
