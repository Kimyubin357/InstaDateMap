import { afterEach, describe, expect, it, vi } from "vitest";
import { requestJson } from "@/lib/client-request";
afterEach(() => vi.unstubAllGlobals());
describe("화면 요청 오류 처리", () => {
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
});
