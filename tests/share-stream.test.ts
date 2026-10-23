import { afterEach, expect, it, vi } from "vitest";
import { readShareResponse, requestShare } from "@/lib/share-stream";
import { RequestTimeoutError } from "@/lib/client-request";
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
it("여러 조각으로 나뉜 한국어 진행·결과 스트림을 해석", async () => {
  const bytes = new TextEncoder().encode(JSON.stringify({ type: "progress", stage: "extract" }) + "\n" + JSON.stringify({ type: "result", result: { status: "saved", message: "도나스데이 저장", place_url: "/?place=id" } }) + "\n");
  const body = new ReadableStream({ start(c) { for (let i = 0; i < bytes.length; i += 7) c.enqueue(bytes.slice(i, i + 7)); c.close(); } });
  const stages: string[] = []; const result = await readShareResponse(new Response(body, { headers: { "Content-Type": "application/x-ndjson" } }), (s) => stages.push(s));
  expect(stages).toEqual(["extract"]); expect(result.message).toBe("도나스데이 저장");
});
it("완료 결과 없이 연결이 끝나면 성공으로 표시하지 않음", async () => {
  await expect(readShareResponse(new Response('{"type":"progress","stage":"search"}\n', { headers: { "Content-Type": "application/x-ndjson" } }), () => {})).rejects.toThrow("연결이 끊겼어요");
});
it("링크 요청 헤더가 끝없이 대기해도 시간 제한 뒤 종료하며 재전송하지 않음", async () => {
  vi.useFakeTimers(); let signal: AbortSignal | undefined;
  const fetcher = vi.fn((_url, init) => { signal = init.signal; return new Promise<Response>(() => {}); });
  vi.stubGlobal("fetch", fetcher);
  const result = requestShare({ url: "https://www.instagram.com/reel/ABC/", stream: true }, vi.fn()).catch((e) => e);
  await vi.advanceTimersByTimeAsync(65000);
  expect(await result).toBeInstanceOf(RequestTimeoutError); expect(signal?.aborted).toBe(true); expect(fetcher).toHaveBeenCalledOnce();
});
it("진행만 오고 멈춘 스트림을 취소해 대기와 리더 잠금을 해제함", async () => {
  vi.useFakeTimers(); const cancel = vi.fn(), progress = vi.fn();
  const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode('{"type":"progress","stage":"extract"}\n')); }, cancel });
  vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { headers: { "Content-Type": "application/x-ndjson" } })));
  const result = requestShare({ stream: true }, progress).catch((e) => e);
  await vi.advanceTimersByTimeAsync(15000); expect(progress).toHaveBeenCalledWith("extract"); expect(cancel).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(50000);
  expect(await result).toBeInstanceOf(RequestTimeoutError); expect(cancel).toHaveBeenCalledOnce(); expect(body.locked).toBe(false);
});
it("일반 JSON 응답 본문이 멈춰도 링크 처리 시간 제한이 적용됨", async () => {
  vi.useFakeTimers();
  const response = new Response("{}", { headers: { "Content-Type": "application/json" } });
  vi.spyOn(response, "json").mockImplementation(() => new Promise(() => {}));
  vi.stubGlobal("fetch", vi.fn(async () => response));
  const result = requestShare({}, vi.fn()).catch((e) => e);
  await vi.advanceTimersByTimeAsync(65000); expect(await result).toBeInstanceOf(RequestTimeoutError);
});
it("완료 결과를 받으면 연결 종료를 기다리지 않고 반환함", async () => {
  vi.useFakeTimers(); let controller!: ReadableStreamDefaultController<Uint8Array>;
  const cancel = vi.fn();
  const expected = { status: "saved", message: "저장 완료", place_url: "/?place=p1" };
  const body = new ReadableStream<Uint8Array>({ start(c) { controller = c; c.enqueue(new TextEncoder().encode(JSON.stringify({ type: "result", result: expected }) + "\n")); }, cancel });
  vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { headers: { "Content-Type": "application/x-ndjson" } })));
  const received = vi.fn(); const result = requestShare({}, vi.fn()).then(received);
  try {
    await vi.advanceTimersByTimeAsync(1);
    expect(received).toHaveBeenCalledWith(expected); expect(cancel).toHaveBeenCalledOnce(); expect(body.locked).toBe(false);
  } finally { try { controller.close(); } catch {} await result; }
});
it("이미 취소된 신호로 늦게 도착한 응답을 읽지 않고 정리함", async () => {
  vi.useFakeTimers(); let controller!: ReadableStreamDefaultController<Uint8Array>;
  const abort = new AbortController(), reason = new RequestTimeoutError(), cancel = vi.fn(), progress = vi.fn();
  abort.abort(reason);
  const body = new ReadableStream<Uint8Array>({ start(c) { controller = c; c.enqueue(new TextEncoder().encode('{"type":"progress","stage":"search"}\n')); }, cancel });
  const rejected = vi.fn(); const result = readShareResponse(new Response(body, { headers: { "Content-Type": "application/x-ndjson" } }), progress, abort.signal).catch(rejected);
  try {
    await vi.advanceTimersByTimeAsync(1);
    expect(rejected).toHaveBeenCalledWith(reason); expect(progress).not.toHaveBeenCalled(); expect(cancel).toHaveBeenCalledOnce(); expect(body.locked).toBe(false);
  } finally { try { controller.close(); } catch {} await result; }
});
