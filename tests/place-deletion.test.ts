import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectionError, requestJson, RequestError } from "@/lib/client-request";
import { PlaceDeletion, PlaceDeletionBatch } from "@/lib/place-deletion";

vi.mock("@/lib/client-request", async (original) => ({ ...await original<typeof import("@/lib/client-request")>(), requestJson: vi.fn() }));
const request = vi.mocked(requestJson);
const deleted = (id = "p1") => ({ ok: true, deleted_id: id });
const missing = () => new RequestError("이미 삭제된 장소예요.", 404, "PLACE_NOT_FOUND");
beforeEach(() => vi.resetAllMocks());

describe("리스트 개별 장소 삭제 확인", () => {
  it("선택한 장소의 삭제 응답이 일치할 때 완료", async () => {
    request.mockResolvedValueOnce(deleted());
    const deletion = new PlaceDeletion("p1");
    expect(await deletion.run(vi.fn())).toEqual(deleted());
    expect(request).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledWith("/api/places/p1", { method: "DELETE" });
    expect(deletion.pending).toBe(false);
  });

  it("응답이 유실돼도 서버에서 삭제가 확인되면 재전송 없이 완료", async () => {
    request.mockRejectedValueOnce(new ConnectionError()).mockRejectedValueOnce(missing());
    const checking = vi.fn();
    expect(await new PlaceDeletion("p1").run(checking)).toEqual(deleted());
    expect(checking).toHaveBeenCalledOnce();
    expect(request.mock.calls).toEqual([["/api/places/p1", { method: "DELETE" }], ["/api/places/p1", { cache: "no-store" }]]);
  });

  it("다른 장소의 삭제 응답이나 불명확한 404를 성공으로 표시하지 않음", async () => {
    request.mockResolvedValueOnce(deleted("p2")).mockRejectedValueOnce(new RequestError("경로를 찾지 못했어요.", 404));
    const deletion = new PlaceDeletion("p1");
    await expect(deletion.run(vi.fn())).rejects.toMatchObject({ status: 404 });
  });

  it("미확인 재시도는 먼저 조회하고 남아 있을 때만 원래 장소를 다시 삭제", async () => {
    request.mockRejectedValueOnce(new ConnectionError()).mockRejectedValueOnce(new ConnectionError());
    const deletion = new PlaceDeletion("p1");
    await expect(deletion.run(vi.fn())).rejects.toThrow("삭제 여부를 아직 확인하지 못했어요.");
    expect(deletion.pending).toBe(true);
    request.mockResolvedValueOnce({ place: { id: "p1" } }).mockResolvedValueOnce(deleted());
    expect(await deletion.run(vi.fn())).toEqual(deleted());
    expect(request.mock.calls.slice(2)).toEqual([["/api/places/p1", { cache: "no-store" }], ["/api/places/p1", { method: "DELETE" }]]);
    expect(deletion.pending).toBe(false);
  });

  it("재시도 조회도 실패하면 추가 삭제 요청을 보내지 않음", async () => {
    request.mockRejectedValue(new ConnectionError());
    const deletion = new PlaceDeletion("p1");
    await expect(deletion.run(vi.fn())).rejects.toThrow();
    await expect(deletion.run(vi.fn())).rejects.toThrow();
    expect(request.mock.calls.filter(([, init]) => init?.method === "DELETE")).toHaveLength(1);
    expect(deletion.pending).toBe(true);
  });

  it("인증 만료는 숨기지 않고 화면 잠금 처리에 전달", async () => {
    const expired = new RequestError("다시 입장해 주세요.", 401);
    request.mockRejectedValueOnce(expired);
    const deletion = new PlaceDeletion("p1");
    await expect(deletion.run(vi.fn())).rejects.toBe(expired);
    expect(request).toHaveBeenCalledOnce();
    expect(deletion.pending).toBe(false);
  });
});

describe("선택한 장소 일괄 삭제", () => {
  it("중복 ID를 한 번씩 삭제하고 확인된 장소만 목록에서 제거", async () => {
    request.mockImplementation(async (url) => deleted(url.split("/").at(-1)));
    const batch = new PlaceDeletionBatch(["p1", "p2", "p1"]), removed = vi.fn();
    await batch.run(removed, vi.fn());
    expect(request.mock.calls.map(([url]) => url)).toEqual(["/api/places/p1", "/api/places/p2"]);
    expect(removed.mock.calls).toEqual([["p1"], ["p2"]]);
    expect(batch.completedIds).toEqual(["p1", "p2"]);
  });

  it("부분 실패 후 완료한 장소를 재삭제하지 않고 남은 장소부터 재시도", async () => {
    request.mockResolvedValueOnce(deleted()).mockRejectedValueOnce(new RequestError("삭제하지 못했어요.", 400));
    const batch = new PlaceDeletionBatch(["p1", "p2", "p3"]), removed = vi.fn();
    await expect(batch.run(removed, vi.fn())).rejects.toMatchObject({ status: 400 });
    expect(batch.completedIds).toEqual(["p1"]);
    expect(request).toHaveBeenCalledTimes(2);
    request.mockResolvedValueOnce(deleted("p2")).mockResolvedValueOnce(deleted("p3"));
    await batch.run(removed, vi.fn());
    expect(request.mock.calls.map(([url]) => url)).toEqual(["/api/places/p1", "/api/places/p2", "/api/places/p2", "/api/places/p3"]);
    expect(removed.mock.calls).toEqual([["p1"], ["p2"], ["p3"]]);
  });

  it("미확인 장소의 재시도는 조회부터 수행하고 뒤의 장소를 임의로 지우지 않음", async () => {
    request.mockResolvedValueOnce(deleted()).mockRejectedValueOnce(new ConnectionError()).mockRejectedValueOnce(new ConnectionError());
    const batch = new PlaceDeletionBatch(["p1", "p2", "p3"]), removed = vi.fn();
    await expect(batch.run(removed, vi.fn())).rejects.toThrow();
    expect(batch.pending).toBe(true);
    expect(batch.completedIds).toEqual(["p1"]);
    request.mockRejectedValueOnce(missing()).mockResolvedValueOnce(deleted("p3"));
    await batch.run(removed, vi.fn());
    expect(request.mock.calls.slice(3)).toEqual([["/api/places/p2", { cache: "no-store" }], ["/api/places/p3", { method: "DELETE" }]]);
    expect(batch.pending).toBe(false);
    expect(removed.mock.calls).toEqual([["p1"], ["p2"], ["p3"]]);
  });

  it("중복 실행을 합치고 인증이 만료되면 뒤의 삭제를 중단", async () => {
    let reject!: (error: unknown) => void;
    request.mockReturnValueOnce(new Promise((_, fail) => { reject = fail; }));
    const batch = new PlaceDeletionBatch(["p1", "p2"]), removed = vi.fn();
    const first = batch.run(removed, vi.fn());
    expect(batch.run(removed, vi.fn())).toBe(first);
    reject(new RequestError("다시 입장해 주세요.", 401));
    await expect(first).rejects.toMatchObject({ status: 401 });
    expect(request).toHaveBeenCalledOnce();
    expect(removed).not.toHaveBeenCalled();
  });
});
