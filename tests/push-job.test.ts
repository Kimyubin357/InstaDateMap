import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, reset, tables } from "./fakeDb";
vi.mock("@/lib/db", () => ({ db: () => fakeDb }));
vi.mock("@/lib/push-server", () => ({ deliverPlacePushes: vi.fn(async () => {}), pushConfiguration: vi.fn(() => ({ publicKey: "test" })) }));
import { deliverPlacePushes, pushConfiguration } from "@/lib/push-server";
import { POST } from "@/app/api/jobs/push/route";
const request = (secret?: string) => new Request("http://localhost/api/jobs/push", { method: "POST", headers: secret ? { authorization: `Bearer ${secret}` } : {} });
beforeEach(() => { reset(); vi.clearAllMocks(); vi.stubEnv("CRON_SECRET", "test-job-secret"); vi.stubEnv("APP_BOARD_ID", ""); tables.boards = [{ id: "b1" }]; });
afterEach(() => { vi.unstubAllEnvs(); });
describe("사용자 활동 없는 알림 예약 실행", () => {
  it("브라우저 쿠키 없이 예약 비밀키로 발송을 실행하고 완료까지 대기", async () => {
    expect((await POST(request("test-job-secret"))).status).toBe(200); expect(deliverPlacePushes).toHaveBeenCalledWith("b1");
  });
  it("미설정·잘못된 비밀키는 DB나 발송에 접근하지 못함", async () => {
    for (const secret of [undefined, "wrong"]) expect((await POST(request(secret))).status).toBe(401);
    vi.stubEnv("CRON_SECRET", ""); expect((await POST(request("test-job-secret"))).status).toBe(401); expect(deliverPlacePushes).not.toHaveBeenCalled();
  });
  it("여러 보드는 지정된 APP_BOARD_ID만 재시도", async () => {
    tables.boards.push({ id: "b2" }); expect((await POST(request("test-job-secret"))).status).toBe(503);
    vi.stubEnv("APP_BOARD_ID", "b2"); expect((await POST(request("test-job-secret"))).status).toBe(200); expect(deliverPlacePushes).toHaveBeenCalledWith("b2");
  });
  it("발송 준비나 DB 오류를 예약 성공으로 숨기지 않음", async () => {
    vi.mocked(pushConfiguration).mockReturnValueOnce(null);
    expect((await POST(request("test-job-secret"))).status).toBe(503);
    vi.mocked(deliverPlacePushes).mockRejectedValueOnce(new Error("DB failed"));
    expect((await POST(request("test-job-secret"))).status).toBe(503);
  });
});
