import { describe, expect, it, vi } from "vitest";
import { ConnectionError, RequestError, RequestTimeoutError } from "@/lib/client-request";
import { UnconfirmedWriteError, VerifiedWrite } from "@/lib/verified-write";

describe("응답을 놓친 저장의 재확인", () => {
  it("정상 응답은 추가 조회 없이 완료함", async () => {
    const write = new VerifiedWrite<string>(), send = vi.fn(async () => "저장한 값"), verify = vi.fn(), checking = vi.fn();
    expect(await write.run(send, verify, checking)).toBe("저장한 값");
    expect(write.pending).toBe(false); expect(verify).not.toHaveBeenCalled(); expect(checking).not.toHaveBeenCalled();
  });
  it("저장 버튼을 연속으로 눌러도 진행 중 요청 하나를 공유하고 완료 뒤에는 새 저장이 가능", async () => {
    const write = new VerifiedWrite<string>();
    let resolve!: (value: string) => void;
    const response = new Promise<string>((done) => { resolve = done; });
    const send = vi.fn(() => response), otherSend = vi.fn(async () => "다른 입력"), verify = vi.fn(), checking = vi.fn();
    const first = write.run(send, verify, checking), second = write.run(otherSend, verify, checking);
    expect(second).toBe(first); expect(send).toHaveBeenCalledOnce(); expect(otherSend).not.toHaveBeenCalled();
    resolve("저장한 값");
    expect(await Promise.all([first, second])).toEqual(["저장한 값", "저장한 값"]);
    expect(write.pending).toBe(false); expect(verify).not.toHaveBeenCalled();
    expect(await write.run(otherSend, verify, checking)).toBe("다른 입력"); expect(otherSend).toHaveBeenCalledOnce();
  });
  it("응답 유실 후 재확인을 연속으로 눌러도 조회 하나를 공유하고 중복 저장하지 않음", async () => {
    const write = new VerifiedWrite<string>(), send = vi.fn().mockRejectedValue(new RequestTimeoutError());
    let resolve!: (value: string) => void;
    const readback = new Promise<string>((done) => { resolve = done; });
    const verify = vi.fn().mockResolvedValueOnce(null).mockReturnValueOnce(readback);
    await expect(write.run(send, verify, vi.fn())).rejects.toBeInstanceOf(UnconfirmedWriteError);
    const newSend = vi.fn(async () => "새 입력"), newVerify = vi.fn();
    const first = write.run(newSend, newVerify, vi.fn()), second = write.run(newSend, newVerify, vi.fn());
    expect(second).toBe(first); expect(verify).toHaveBeenCalledTimes(2);
    resolve("확인된 저장");
    expect(await Promise.all([first, second])).toEqual(["확인된 저장", "확인된 저장"]);
    expect(send).toHaveBeenCalledOnce(); expect(newSend).not.toHaveBeenCalled(); expect(newVerify).not.toHaveBeenCalled();
    expect(write.pending).toBe(false);
  });
  it.each([new RequestTimeoutError(), new ConnectionError()])("응답 유실 후 서버 값이 일치하면 재저장 없이 성공함 (%s)", async (error) => {
    const write = new VerifiedWrite<string>(), send = vi.fn().mockRejectedValue(error), verify = vi.fn(async () => "서버에 저장된 값"), checking = vi.fn();
    expect(await write.run(send, verify, checking)).toBe("서버에 저장된 값");
    expect(send).toHaveBeenCalledOnce(); expect(verify).toHaveBeenCalledOnce(); expect(checking).toHaveBeenCalledOnce(); expect(write.pending).toBe(false);
  });
  it("불일치하면 자동 재저장하지 않고 다음 시도에서도 조회부터 함", async () => {
    const order: string[] = [], write = new VerifiedWrite<string>();
    const original = vi.fn(async () => { order.push("원래 저장"); if (order.length === 1) throw new RequestTimeoutError(); return "원래 메모"; });
    const verify = vi.fn(async () => { order.push("서버 확인"); return null; });
    await expect(write.run(original, verify, vi.fn())).rejects.toBeInstanceOf(UnconfirmedWriteError);
    expect(write.pending).toBe(true); expect(order).toEqual(["원래 저장", "서버 확인"]);
    const changed = vi.fn(async () => "바뀐 메모"), changedVerify = vi.fn(async () => "바뀐 메모");
    expect(await write.run(changed, changedVerify, vi.fn())).toBe("원래 메모");
    expect(order).toEqual(["원래 저장", "서버 확인", "서버 확인", "원래 저장"]);
    expect(changed).not.toHaveBeenCalled(); expect(changedVerify).not.toHaveBeenCalled(); expect(write.pending).toBe(false);
  });
  it("재확인 때 늦게 완료된 저장을 찾으면 원래 요청도 다시 보내지 않음", async () => {
    const write = new VerifiedWrite<string>(), send = vi.fn().mockRejectedValue(new RequestTimeoutError());
    const verify = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce("확인된 메모");
    await expect(write.run(send, verify, vi.fn())).rejects.toBeInstanceOf(UnconfirmedWriteError);
    const laterSend = vi.fn();
    expect(await write.run(laterSend, vi.fn(), vi.fn())).toBe("확인된 메모");
    expect(send).toHaveBeenCalledOnce(); expect(laterSend).not.toHaveBeenCalled(); expect(write.pending).toBe(false);
  });
  it("재조회가 끊기면 저장을 재전송하지 않고 보류 상태를 유지함", async () => {
    const write = new VerifiedWrite<string>(), send = vi.fn().mockRejectedValue(new RequestTimeoutError());
    const readError = new ConnectionError(), verify = vi.fn().mockRejectedValue(readError);
    await expect(write.run(send, verify, vi.fn())).rejects.toBeInstanceOf(UnconfirmedWriteError);
    expect(write.pending).toBe(true);
    const laterSend = vi.fn();
    await expect(write.run(laterSend, vi.fn(), vi.fn())).rejects.toBe(readError);
    expect(send).toHaveBeenCalledOnce(); expect(laterSend).not.toHaveBeenCalled(); expect(write.pending).toBe(true);
  });
  it("아직 서버가 처리 중이라는 재확인 결과도 재전송하지 않음", async () => {
    const write = new VerifiedWrite<string>(), send = vi.fn().mockRejectedValue(new RequestTimeoutError());
    const processing = new UnconfirmedWriteError("아직 처리 중이에요."), verify = vi.fn().mockRejectedValue(processing);
    await expect(write.run(send, verify, vi.fn())).rejects.toBeInstanceOf(UnconfirmedWriteError);
    await expect(write.run(vi.fn(), vi.fn(), vi.fn())).rejects.toBe(processing);
    expect(send).toHaveBeenCalledOnce(); expect(write.pending).toBe(true);
  });
  it("첫 재확인에서 삭제가 확인되면 404를 그대로 전달하고 보류를 끝냄", async () => {
    const write = new VerifiedWrite<string>(), missing = new RequestError("이미 삭제된 장소예요.", 404);
    const send = vi.fn().mockRejectedValue(new RequestTimeoutError()), verify = vi.fn().mockRejectedValue(missing);
    await expect(write.run(send, verify, vi.fn())).rejects.toBe(missing);
    expect(write.pending).toBe(false); expect(send).toHaveBeenCalledOnce();
  });
  it("사용자가 다시 확인하는 중 삭제가 확인돼도 보류를 끝내고 재저장하지 않음", async () => {
    const write = new VerifiedWrite<string>(), missing = new RequestError("이미 삭제된 장소예요.", 404);
    const send = vi.fn().mockRejectedValue(new RequestTimeoutError()), verify = vi.fn().mockResolvedValueOnce(null).mockRejectedValueOnce(missing);
    await expect(write.run(send, verify, vi.fn())).rejects.toBeInstanceOf(UnconfirmedWriteError);
    await expect(write.run(vi.fn(), vi.fn(), vi.fn())).rejects.toBe(missing);
    expect(write.pending).toBe(false); expect(send).toHaveBeenCalledOnce();
  });
  it("명확한 요청 오류는 재확인 없이 원래 오류를 반환함", async () => {
    const write = new VerifiedWrite<string>(), error = new RequestError("메모가 너무 길어요.", 400);
    const send = vi.fn().mockRejectedValue(error), verify = vi.fn(), checking = vi.fn();
    await expect(write.run(send, verify, checking)).rejects.toBe(error);
    expect(verify).not.toHaveBeenCalled(); expect(checking).not.toHaveBeenCalled(); expect(write.pending).toBe(false);
  });
  it.each([401, 409])("재확인 중 권한 오류 %s를 숨기지 않고 보류를 끝냄", async (status) => {
    for (const later of [false, true]) {
      const write = new VerifiedWrite<string>(), error = new RequestError("입장 상태 확인이 필요해요.", status);
      const send = vi.fn().mockRejectedValue(new RequestTimeoutError()), verify = vi.fn();
      if (later) verify.mockResolvedValueOnce(null);
      verify.mockRejectedValue(error);
      if (later) await expect(write.run(send, verify, vi.fn())).rejects.toBeInstanceOf(UnconfirmedWriteError);
      await expect(write.run(send, verify, vi.fn())).rejects.toBe(error);
      expect(write.pending).toBe(false); expect(send).toHaveBeenCalledOnce();
    }
  });
});
