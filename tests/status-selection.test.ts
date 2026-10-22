import { describe, expect, it, vi } from "vitest";
import { StatusSelection } from "@/lib/status-selection";
function deferred() {
  let resolve!: () => void, reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
describe("즉시 표시하는 장소 상태", () => {
  it("서버 응답 전에 선택을 표시하고 성공 후 한 번만 알림", async () => {
    const request = deferred(), saved = vi.fn(), failed = vi.fn();
    const selection = new StatusSelection("wish", () => request.promise, saved, failed);
    selection.select("again"); expect(selection.getSnapshot()).toEqual({ status: "again", pending: true });
    request.resolve(); await vi.waitFor(() => expect(selection.getSnapshot().pending).toBe(false));
    expect(selection.getSnapshot().status).toBe("again"); expect(saved).toHaveBeenCalledOnce(); expect(failed).not.toHaveBeenCalled();
  });
  it("빠른 연속 선택은 동시에 보내지 않고 마지막 선택을 이어서 저장", async () => {
    const first = deferred(), last = deferred(), saved = vi.fn();
    const write = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(last.promise);
    const selection = new StatusSelection("wish", write, saved, vi.fn());
    selection.select("again"); selection.select("visited"); selection.select("meh");
    expect(selection.getSnapshot().status).toBe("meh"); expect(write).toHaveBeenCalledTimes(1);
    first.resolve(); await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(2)); expect(write.mock.calls.map(([value]) => value)).toEqual(["again", "meh"]);
    expect(saved).not.toHaveBeenCalled(); last.resolve(); await vi.waitFor(() => expect(selection.getSnapshot().pending).toBe(false)); expect(saved).toHaveBeenCalledOnce();
  });
  it("실패하면 마지막으로 서버가 확인한 상태로 되돌림", async () => {
    const first = deferred(), last = deferred(), saved = vi.fn(), failed = vi.fn();
    const selection = new StatusSelection("wish", vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(last.promise), saved, failed);
    selection.select("again"); selection.select("visited"); first.resolve(); await Promise.resolve();
    last.reject(new Error("연결 실패")); await vi.waitFor(() => expect(selection.getSnapshot()).toEqual({ status: "again", pending: false }));
    expect(failed).toHaveBeenCalledOnce(); expect(saved).not.toHaveBeenCalled();
  });
  it("첫 요청 실패 뒤에도 새로 선택한 상태는 저장할 수 있음", async () => {
    const first = deferred(), last = deferred(), saved = vi.fn(), failed = vi.fn();
    const write = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(last.promise);
    const selection = new StatusSelection("wish", write, saved, failed);
    selection.select("again"); selection.select("meh"); first.reject(new Error("첫 요청 실패"));
    await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(2)); expect(selection.getSnapshot().status).toBe("meh");
    last.resolve(); await vi.waitFor(() => expect(saved).toHaveBeenCalledOnce()); expect(failed).not.toHaveBeenCalled();
  });
  it("저장 중 늦게 도착한 조회가 선택을 되돌리지 않음", async () => {
    const request = deferred(); const selection = new StatusSelection("wish", () => request.promise, vi.fn(), vi.fn());
    selection.select("again"); selection.receive("wish"); expect(selection.getSnapshot().status).toBe("again");
    request.resolve(); await vi.waitFor(() => expect(selection.getSnapshot().pending).toBe(false));
    selection.receive("visited"); expect(selection.getSnapshot()).toEqual({ status: "visited", pending: false });
  });
  it("같은 상태 재선택은 요청하지 않고, 실패 후 재시도 가능", async () => {
    const write = vi.fn().mockRejectedValueOnce(new Error("오류")).mockResolvedValue(undefined), failed = vi.fn();
    const selection = new StatusSelection("wish", write, vi.fn(), failed);
    selection.select("wish"); expect(write).not.toHaveBeenCalled(); selection.select("again");
    await vi.waitFor(() => expect(failed).toHaveBeenCalledOnce()); selection.select("again");
    await vi.waitFor(() => expect(selection.getSnapshot()).toEqual({ status: "again", pending: false })); expect(write).toHaveBeenCalledTimes(2);
  });
  it("화면 구독이 종료되어도 이미 선택한 마지막 상태를 끝까지 저장", async () => {
    const request = deferred(), write = vi.fn().mockReturnValueOnce(request.promise).mockResolvedValue(undefined);
    const selection = new StatusSelection("wish", write, vi.fn(), vi.fn()), unsubscribe = selection.subscribe(vi.fn());
    selection.select("again"); selection.select("visited"); unsubscribe(); request.resolve();
    await vi.waitFor(() => expect(selection.getSnapshot()).toEqual({ status: "visited", pending: false })); expect(write.mock.calls.map(([value]) => value)).toEqual(["again", "visited"]);
  });
});
