import { afterEach, describe, expect, it, vi } from "vitest";
import { collectionUndo } from "@/lib/collection-undo";
import { ConnectionError, RequestError, requestJson } from "@/lib/client-request";
import { UnconfirmedWriteError } from "@/lib/verified-write";

vi.mock("@/lib/client-request", async (original) => ({ ...await original<typeof import("@/lib/client-request")>(), requestJson: vi.fn() }));
const request = vi.mocked(requestJson);
const result = { ok: true, operation_id: "undo-receipt", changed: 1 };
afterEach(() => vi.resetAllMocks());

describe("토스트에서 모음 변경 되돌리기", () => {
  it("원래 변경만 되돌리고 조회를 갱신한 뒤 성공을 알림", async () => {
    request.mockResolvedValue(result);
    const refresh = vi.fn(async () => {}), lock = vi.fn();
    const undo = collectionUndo("original-operation", refresh, lock);
    expect(await undo()).toBe("변경을 되돌렸어요.");
    const payload = JSON.parse(request.mock.calls[0][1]!.body as string);
    expect(payload.command).toEqual({ action: "undo", target: "original-operation" });
    expect(payload.operation_id).toBeTruthy();
    expect(refresh).toHaveBeenCalledOnce(); expect(lock).not.toHaveBeenCalled();
  });
  it("응답을 놓쳤어도 처리 기록을 찾으면 재전송 없이 성공함", async () => {
    request.mockRejectedValueOnce(new ConnectionError()).mockResolvedValueOnce({ result });
    const refresh = vi.fn(async () => {});
    expect(await collectionUndo("original", refresh, vi.fn())()).toBe("변경을 되돌렸어요.");
    expect(request).toHaveBeenCalledTimes(2);
    const payload = JSON.parse(request.mock.calls[0][1]!.body as string);
    expect(request.mock.calls[1][0]).toBe(`/api/collections?operation=${payload.operation_id}`);
    expect(refresh).toHaveBeenCalledOnce();
  });
  it("결과가 불확실하면 성공을 알리지 않고 재확인 후 같은 요청 ID로만 재전송함", async () => {
    request.mockRejectedValueOnce(new ConnectionError()).mockResolvedValueOnce({ result: null })
      .mockResolvedValueOnce({ result: null }).mockResolvedValueOnce(result);
    const refresh = vi.fn(async () => {}), undo = collectionUndo("original", refresh, vi.fn());
    await expect(undo()).rejects.toBeInstanceOf(UnconfirmedWriteError);
    expect(refresh).not.toHaveBeenCalled();
    expect(await undo()).toBe("변경을 되돌렸어요.");
    expect(request.mock.calls[2][0]).toBe(request.mock.calls[1][0]);
    expect(request.mock.calls[3][1]!.body).toBe(request.mock.calls[0][1]!.body);
    expect(refresh).toHaveBeenCalledOnce();
  });
  it("서버의 처리 확인 응답도 조회로 확인함", async () => {
    request.mockRejectedValueOnce(new RequestError("결과를 확인하고 있어요.", 503, "COLLECTION_UNCONFIRMED")).mockResolvedValueOnce({ result });
    expect(await collectionUndo("original", vi.fn(), vi.fn())()).toBe("변경을 되돌렸어요.");
    expect(request).toHaveBeenCalledTimes(2);
  });
  it("인증이 만료되면 잠그고 성공 안내를 만들지 않음", async () => {
    request.mockRejectedValueOnce(new RequestError("다시 입장해 주세요.", 401));
    const refresh = vi.fn(), lock = vi.fn();
    expect(await collectionUndo("original", refresh, lock)()).toBeUndefined();
    expect(lock).toHaveBeenCalledOnce(); expect(refresh).not.toHaveBeenCalled();
  });
  it("각 안내의 되돌리기는 서로 다른 처리 기록을 유지함", async () => {
    request.mockResolvedValue(result);
    const first = collectionUndo("first", vi.fn(), vi.fn()), second = collectionUndo("second", vi.fn(), vi.fn());
    await first(); await second();
    const payloads = request.mock.calls.map(([, init]) => JSON.parse(init!.body as string));
    expect(payloads[0].operation_id).not.toBe(payloads[1].operation_id);
    expect(payloads.map((p) => p.command.target)).toEqual(["first", "second"]);
  });
});
