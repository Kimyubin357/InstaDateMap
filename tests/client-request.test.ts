import { afterEach, describe, expect, it, vi } from "vitest";
import { requestJson, RequestError, RequestTimeoutError, withRequestDeadline } from "@/lib/client-request";
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe("화면 요청 오류 처리", () => {
  it("작업 권한 확보·반납만 변경 알림을 생략하며 제외·장소 저장은 계속 알림", async () => {
    const target = new EventTarget(), changed = vi.fn(); target.addEventListener("datemap:changed", changed);
    vi.stubGlobal("window", target);
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ ok: true })); vi.stubGlobal("fetch", fetcher);
    for (const action of ["claim", "release"]) {
      await requestJson("/api/sources/id/session", { method: "POST", body: JSON.stringify({ action }), notifyBoardChange: false });
    }
    expect(changed).not.toHaveBeenCalled();
    for (const [, init] of fetcher.mock.calls) {
      expect(init).not.toHaveProperty("notifyBoardChange");
    }
    await requestJson("/api/sources/id/session", { method: "POST", body: JSON.stringify({ action: "dismiss" }) });
    await requestJson("/api/places", { method: "POST" });
    await requestJson("/api/places/id", { method: "PATCH", notifyBoardChange: true });
    expect(changed).toHaveBeenCalledTimes(3);
  });

  it("상태 수정·삭제 HTTP 실패를 서버 메시지로 전달", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ message: "저장 실패" }, { status: 500 })));
    await expect(requestJson("/api/places/id", { method: "PATCH" })).rejects.toThrow("저장 실패");
    await expect(requestJson("/api/places/id", { method: "DELETE" })).rejects.toThrow("저장 실패");
  });
  it("연결 끊김과 잘못된 응답을 실패로 전달", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValueOnce(new TypeError("fetch failed")).mockResolvedValueOnce(new Response("invalid")));
    await expect(requestJson("/api/search")).rejects.toThrow("연결");
    await expect(requestJson("/api/search")).rejects.toThrow("응답");
  });

  it("삭제된 장소의 오류 코드를 성공 데이터로 처리하지 않고 전달", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ code: "PLACE_NOT_FOUND", message: "이미 삭제된 장소예요." }, { status: 404 })));
    const failure = await requestJson("/api/places/id", { method: "PATCH" }).catch((error) => error);
    expect(failure).toBeInstanceOf(RequestError);
    expect(failure).toMatchObject({ status: 404, code: "PLACE_NOT_FOUND" });
  });

  it.each(["headers", "body"])("%s 응답이 영원히 멈춰도 제한 시간 후 끝나고 다음 요청은 성공", async (phase) => {
    vi.useFakeTimers();
    let captured: AbortSignal | null | undefined;
    const never = new Promise<never>(() => {});
    const stalledBody = Response.json({}); vi.spyOn(stalledBody, "json").mockImplementation(() => never);
    const fetcher = vi.fn<typeof fetch>().mockImplementationOnce(async (_url, init) => {
      captured = init?.signal;
      return phase === "headers" ? never : stalledBody;
    }).mockResolvedValueOnce(Response.json({ places: ["새 목록"] }));
    vi.stubGlobal("fetch", fetcher);
    const first = requestJson("/api/places", { timeoutMs: 1000 });
    const failure = expect(first).rejects.toBeInstanceOf(RequestTimeoutError);
    await vi.advanceTimersByTimeAsync(999);
    expect(captured?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await failure;
    expect(captured?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    await expect(requestJson("/api/places")).resolves.toEqual({ places: ["새 목록"] });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("본문 시간 초과 뒤 늦게 도착한 저장 성공은 변경 이벤트를 뒤늦게 발생시키지 않음", async () => {
    vi.useFakeTimers();
    const target = new EventTarget(), changed = vi.fn(); target.addEventListener("datemap:changed", changed);
    vi.stubGlobal("window", target);
    let resolve!: (value: unknown) => void;
    const body = new Promise((done) => { resolve = done; });
    const stalledBody = Response.json({}); vi.spyOn(stalledBody, "json").mockImplementation(() => body);
    vi.stubGlobal("fetch", vi.fn(async () => stalledBody));
    const request = requestJson("/api/places/id", { method: "PATCH", timeoutMs: 20 });
    const failure = expect(request).rejects.toBeInstanceOf(RequestTimeoutError);
    await vi.advanceTimersByTimeAsync(20); await failure;
    resolve({ ok: true }); await vi.advanceTimersByTimeAsync(0);
    expect(changed).not.toHaveBeenCalled();
  });

  it("링크 분석 요청은 일반 조회보다 긴 작업 제한을 사용", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>(async () => new Promise<never>(() => {})); vi.stubGlobal("fetch", fetcher);
    const request = requestJson("/api/share", { method: "POST" });
    const failure = expect(request).rejects.toBeInstanceOf(RequestTimeoutError);
    await vi.advanceTimersByTimeAsync(15000);
    expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(50000); await failure;
    expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
  });
});

describe("요청 제한과 취소 정리", () => {
  it("작업이 AbortSignal을 무시해도 외부 취소는 즉시 끝나며 타이머·구독을 정리", async () => {
    vi.useFakeTimers();
    const external = new AbortController(), add = vi.spyOn(external.signal, "addEventListener"), remove = vi.spyOn(external.signal, "removeEventListener");
    let internal!: AbortSignal;
    const request = withRequestDeadline(async (signal) => { internal = signal; return new Promise<never>(() => {}); }, { signal: external.signal });
    const reason = new DOMException("새 검색으로 취소", "AbortError");
    const failure = expect(request).rejects.toBe(reason);
    await Promise.resolve(); external.abort(reason); await failure;
    expect(internal.aborted).toBe(true); expect(internal.reason).toBe(reason);
    expect(remove).toHaveBeenCalledWith("abort", add.mock.calls[0][1]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("이미 취소된 요청은 네트워크 작업을 시작하지 않음", async () => {
    vi.useFakeTimers();
    const external = new AbortController(), task = vi.fn(async () => "실행하지 않음"); external.abort();
    await expect(withRequestDeadline(task, { signal: external.signal })).rejects.toBe(external.signal.reason);
    expect(task).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });

  it("정상 완료도 외부 취소 구독과 제한 타이머를 정리", async () => {
    vi.useFakeTimers();
    const external = new AbortController(), add = vi.spyOn(external.signal, "addEventListener"), remove = vi.spyOn(external.signal, "removeEventListener");
    await expect(withRequestDeadline(async () => "완료", { signal: external.signal })).resolves.toBe("완료");
    expect(remove).toHaveBeenCalledWith("abort", add.mock.calls[0][1]); expect(vi.getTimerCount()).toBe(0);
  });
});
