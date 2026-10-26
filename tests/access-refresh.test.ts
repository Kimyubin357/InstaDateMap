import { afterEach, expect, it, vi } from "vitest";
import { refreshAccess } from "@/lib/access-refresh";
import { RequestTimeoutError } from "@/lib/client-request";
const access = { boardId: "b1", authVersion: 2, who: "유빈", memberNames: ["유빈", "수민"], kakaoKey: "key", expiresAt: "2030-01-01" };
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it.each(["headers", "body"])("PIN 변경 후 %s 무응답은 15초에 끝나고 재시도는 입장 정보만 조회", async (phase) => {
  vi.useFakeTimers();
  const never = new Promise<never>(() => {}), stalled = Response.json({});
  vi.spyOn(stalled, "json").mockReturnValue(never);
  const fetcher = vi.fn<typeof fetch>().mockImplementationOnce(async () => phase === "headers" ? never : stalled)
    .mockResolvedValueOnce(Response.json(access));
  vi.stubGlobal("fetch", fetcher);
  const failed = expect(refreshAccess()).rejects.toBeInstanceOf(RequestTimeoutError);
  await vi.advanceTimersByTimeAsync(15000); await failed;
  expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
  await expect(refreshAccess()).resolves.toEqual(access);
  expect(fetcher).toHaveBeenCalledTimes(2);
  for (const [url, init] of fetcher.mock.calls) { expect(url).toBe("/api/access/context"); expect(init?.method).toBeUndefined(); }
  expect(vi.getTimerCount()).toBe(0);
});

it.each([401, 409])("%s 응답은 잠금 대상으로 반환하고 오류 본문을 기다리지 않음", async (status) => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(new ReadableStream(), { status })));
  await expect(refreshAccess()).resolves.toBeNull();
});

it("잠금으로 취소한 이전 응답은 늦게 와도 복구되지 않음", async () => {
  let resolve!: (response: Response) => void;
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((done) => { resolve = done; })));
  const controller = new AbortController(), result = refreshAccess(controller.signal);
  const failure = expect(result).rejects.toMatchObject({ name: "AbortError" });
  await Promise.resolve(); controller.abort(); await failure;
  resolve(Response.json(access)); await Promise.resolve();
  await expect(result).rejects.toMatchObject({ name: "AbortError" });
});
