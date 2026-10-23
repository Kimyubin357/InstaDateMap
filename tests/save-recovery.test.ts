import { beforeEach, describe, expect, it, vi } from "vitest";
import { requestJson, RequestError } from "@/lib/client-request";
import { UnconfirmedWriteError } from "@/lib/verified-write";
import { verifyConfirmation, verifyDeletedPlace, verifyDirectSave, verifyPlacePatch, verifySharedLink } from "@/lib/save-recovery";

vi.mock("@/lib/client-request", async (original) => ({ ...await original<typeof import("@/lib/client-request")>(), requestJson: vi.fn() }));
const request = vi.mocked(requestJson);
const choice = { extraction_id: "e1", include: true, place: { kakao_place_id: "k1" } };
const status = () => ({ result: { status: "saved", message: "저장됨", place_url: "/?place=p1" }, source: { id: "s1", status: "done" },
  selections: [{ id: "e1", excluded: false }, { id: "e2", excluded: true }], linked: [{ kakao_place_id: "k1", extraction_id: "e1" }] });
beforeEach(() => vi.resetAllMocks());

describe("저장 결과가 실제로 일치하는지 확인", () => {
  it("메모·상태는 서버 값이 모두 일치할 때만 원래 저장값을 반환함", async () => {
    const patch = { memo: "창가", status: "visited" as const };
    request.mockResolvedValueOnce({ place: patch }).mockResolvedValueOnce({ place: { ...patch, memo: "예전 메모" } });
    expect(await verifyPlacePatch("p1", patch)).toBe(patch);
    expect(request).toHaveBeenCalledWith("/api/places/p1", { cache: "no-store" });
    expect(await verifyPlacePatch("p1", patch)).toBeNull();
  });
  it("빈 메모는 서버 null과 일치하며 조회 실패를 성공으로 바꾸지 않음", async () => {
    request.mockResolvedValueOnce({ place: { memo: null, status: "wish" } }).mockRejectedValueOnce(new Error("조회 실패"));
    expect(await verifyPlacePatch("p1", { memo: "" })).toEqual({ memo: "" });
    await expect(verifyPlacePatch("p1", { memo: "" })).rejects.toThrow("조회 실패");
  });
  it("삭제 확인은 명시적인 PLACE_NOT_FOUND만 성공으로 판단함", async () => {
    request.mockResolvedValueOnce({ place: { id: "p1" } }); expect(await verifyDeletedPlace("p1")).toBeNull();
    request.mockRejectedValueOnce(new RequestError("이미 삭제", 404, "PLACE_NOT_FOUND"));
    expect(await verifyDeletedPlace("p1")).toEqual({ ok: true, deleted_id: "p1" });
    const ordinary404 = new RequestError("API 없음", 404);
    request.mockRejectedValueOnce(ordinary404); await expect(verifyDeletedPlace("p1")).rejects.toBe(ordinary404);
  });
  it("직접 저장 결과가 확인돼야 성공하고 처리 중 원본은 다시 저장하지 않음", async () => {
    const current = status(); request.mockResolvedValueOnce(current);
    expect(await verifyDirectSave("k1")).toEqual(current.result);
    expect(request).toHaveBeenCalledWith("/api/save-status?kakao_place_id=k1", { cache: "no-store" });
    request.mockResolvedValueOnce({ ...current, source: { id: "s1", status: "processing" } });
    await expect(verifyDirectSave("k1", "s1")).rejects.toBeInstanceOf(UnconfirmedWriteError);
  });
  it("원본에 다른 지점만 연결됐다면 선택한 장소가 저장됐다고 판단하지 않음", async () => {
    const current = status(); request.mockResolvedValueOnce(current).mockResolvedValueOnce({ ...current, result: null });
    expect(await verifyDirectSave("k2", "s1")).toBeNull();
    expect(await verifyDirectSave("k1")).toBeNull();
  });
  it("여러 장소 확인은 포함 지점과 제외 여부가 모두 일치해야 완료함", async () => {
    const choices = [choice, { extraction_id: "e2", include: false, place: null }];
    const current = status(); request.mockResolvedValueOnce(current);
    expect(await verifyConfirmation("s1", choices)).toEqual({ saved: 1, place_url: "/?place=p1", saved_place: undefined });
    request.mockResolvedValueOnce({ ...current, selections: [{ id: "e1", excluded: false }, { id: "e2", excluded: false }] });
    expect(await verifyConfirmation("s1", choices)).toBeNull();
    request.mockResolvedValueOnce({ ...current, linked: [{ kakao_place_id: "wrong-branch", extraction_id: "e1" }] });
    expect(await verifyConfirmation("s1", choices)).toBeNull();
  });
  it("장소가 연결돼도 다른 추출 항목이면 선택 저장 완료로 판단하지 않음", async () => {
    request.mockResolvedValueOnce({ ...status(), linked: [{ kakao_place_id: "k1", extraction_id: "e2" }] });
    expect(await verifyConfirmation("s1", [choice])).toBeNull();
  });
  it("아무것도 남기지 않기는 모든 후보 제외와 원본 완료가 확인돼야 함", async () => {
    const choices = [{ extraction_id: "e1", include: false, place: null }];
    const current = { ...status(), result: null, selections: [{ id: "e1", excluded: true }], linked: [] };
    request.mockResolvedValueOnce(current).mockResolvedValueOnce({ ...current, source: { id: "s1", status: "pending_confirm" } });
    expect(await verifyConfirmation("s1", choices)).toEqual({ saved: 0, place_url: undefined, saved_place: undefined });
    expect(await verifyConfirmation("s1", choices)).toBeNull();
  });
  it("링크 재확인은 진행 중이면 보류하고 완료·확인 대기 결과를 그대로 전달함", async () => {
    const result = { status: "confirm", message: "골라 주세요", confirm_url: "/confirm/s1" };
    request.mockResolvedValueOnce({ ...status(), result, source: { id: "s1", status: "pending_confirm" } });
    expect(await verifySharedLink("https://www.instagram.com/reel/ABC/")).toBe(result);
    request.mockResolvedValueOnce({ ...status(), source: { id: "s1", status: "processing" } });
    await expect(verifySharedLink("https://www.instagram.com/reel/ABC/")).rejects.toBeInstanceOf(UnconfirmedWriteError);
  });
});
