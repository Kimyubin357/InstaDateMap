import { afterEach, describe, expect, it, vi } from "vitest";
import { BoardStore } from "@/lib/board-store";
import type { SnapshotCache } from "@/lib/board-cache";
import { isSnapshot, snapshotEtag, type BoardSnapshot, type SyncAccess } from "@/lib/sync-types";
const access: SyncAccess = { boardId: "b1", authVersion: 1, who: "우리", memberNames: ["우리", "서로"], expiresAt: "2030-01-01T00:00:00Z", kakaoKey: "public-map-key" };
const snapshot = (revision = "1", memo = "서버 메모"): BoardSnapshot => ({ boardId: "b1", authVersion: 1, revision, board: "우리 지도", pending: [], places: [{ id: "p1", name: "카페", lat: 37, lng: 127, address: null, category: "카페", kakao_place_id: "k1", kakao_url: null, status: "wish", memo, sharers: ["우리"], sources: [], created_at: "2026-01-01", last_saved_at: "2026-01-01" }] });
function cache(data: BoardSnapshot | null = null): SnapshotCache {
  return { read: vi.fn(async () => data), write: vi.fn(async () => {}), clear: vi.fn(async () => {}) };
}
const response = (data = snapshot()) => Response.json(data);
function deferred<T>() { let resolve!: (v: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { resolve, promise }; }
afterEach(() => vi.useRealTimers());
describe("기기 조회 캐시와 서버 일치", () => {
  it.each(["headers", "body"])("목록 %s 응답이 멈춰도 캐시를 보존하고 시간 초과 안내 후 다시 갱신할 수 있음", async (phase) => {
    vi.useFakeTimers();
    const never = new Promise<never>(() => {}), disk = cache(snapshot());
    const stalledBody = Response.json({}); vi.spyOn(stalledBody, "json").mockImplementation(() => never);
    const fetcher = vi.fn<typeof fetch>().mockImplementationOnce(async () => phase === "headers" ? never : stalledBody)
      .mockResolvedValueOnce(response(snapshot("2", "다시 받은 메모")));
    const store = new BoardStore(disk, fetcher); await store.authorize(access);
    await vi.advanceTimersByTimeAsync(14999);
    expect(store.getSnapshot().syncing).toBe(true); expect(store.getSnapshot().snapshot).toEqual(snapshot());
    await vi.advanceTimersByTimeAsync(1);
    expect(store.getSnapshot().syncing).toBe(false);
    expect(store.getSnapshot().error).toContain("응답이 늦어지고 있어요");
    expect(store.getSnapshot().snapshot).toEqual(snapshot()); expect(disk.write).not.toHaveBeenCalled();
    expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
    await store.refresh();
    expect(fetcher).toHaveBeenCalledTimes(2); expect(store.getSnapshot().syncing).toBe(false);
    expect(store.getSnapshot().error).toBe(""); expect(store.getSnapshot().snapshot).toEqual(snapshot("2", "다시 받은 메모"));
    store.suspend(); expect(vi.getTimerCount()).toBe(0);
  });

  it("시간 초과된 이전 응답이 나중에 와도 재시도로 받은 목록과 디스크를 덮지 않음", async () => {
    vi.useFakeTimers();
    const old = deferred<Response>(), disk = cache(snapshot());
    const fetcher = vi.fn<typeof fetch>().mockReturnValueOnce(old.promise).mockResolvedValueOnce(response(snapshot("2", "최신 목록")));
    const store = new BoardStore(disk, fetcher); await store.authorize(access);
    await vi.advanceTimersByTimeAsync(15000); await store.refresh();
    expect(store.getSnapshot().snapshot).toEqual(snapshot("2", "최신 목록"));
    // A timed-out request is abandoned regardless of the revision in its late response.
    old.resolve(response(snapshot("99", "버려야 할 응답"))); await vi.advanceTimersByTimeAsync(0);
    expect(store.getSnapshot().snapshot).toEqual(snapshot("2", "최신 목록"));
    expect(disk.write).toHaveBeenCalledTimes(1); expect(disk.write).toHaveBeenLastCalledWith(snapshot("2", "최신 목록"));
    store.suspend();
  });

  it("갱신 중 받은 이벤트는 시간 초과로 기존 대기를 끝낸 뒤 별도 조회로 복구", async () => {
    vi.useFakeTimers();
    const disk = cache(snapshot()), fetcher = vi.fn<typeof fetch>().mockImplementationOnce(async () => new Promise<never>(() => {}))
      .mockResolvedValueOnce(response(snapshot("2", "상대방의 새 메모")));
    const store = new BoardStore(disk, fetcher), errors: string[] = [];
    const unsubscribe = store.subscribe(() => { if (store.getSnapshot().error) errors.push(store.getSnapshot().error); });
    await store.authorize(access);
    const settled = vi.fn(); void store.refresh().then(settled);
    store.schedule(); await vi.advanceTimersByTimeAsync(250);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(14750);
    expect(errors.some((error) => error.includes("응답이 늦어지고 있어요"))).toBe(true);
    expect(settled).toHaveBeenCalledOnce(); expect(store.getSnapshot().syncing).toBe(false);
    expect(store.getSnapshot().snapshot).toEqual(snapshot()); expect(fetcher).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(249); expect(fetcher).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetcher).toHaveBeenCalledTimes(2); expect(store.getSnapshot().syncing).toBe(false);
    expect(store.getSnapshot().snapshot).toEqual(snapshot("2", "상대방의 새 메모"));
    unsubscribe(); store.suspend();
  });

  it("잠금 취소는 실패 알림 없이 대기를 끝내며 늦은 요청도 목록을 복원하지 않음", async () => {
    vi.useFakeTimers();
    const disk = cache(snapshot()), fetcher = vi.fn<typeof fetch>(async () => new Promise<never>(() => {}));
    const store = new BoardStore(disk, fetcher); await store.authorize(access); await vi.advanceTimersByTimeAsync(0);
    await store.forget(); await vi.advanceTimersByTimeAsync(15000);
    expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
    expect(store.getSnapshot().syncing).toBe(false); expect(store.getSnapshot().error).toBe("");
    expect(store.getSnapshot().snapshot).toBeNull(); expect(vi.getTimerCount()).toBe(0);
  });

  it("PIN 재인증 동안 화면 정보만 유지하며 장소·기기 캐시는 지우고 요청은 중단", async () => {
    const pending = deferred<Response>(), disk = cache(snapshot()), fetcher = vi.fn(() => pending.promise);
    const store = new BoardStore(disk, fetcher as typeof fetch); await store.authorize(access); await Promise.resolve();
    const seen: unknown[] = []; const unsubscribe = store.subscribe(() => seen.push(store.getSnapshot().access));
    await store.forget({ keepShell: true });
    expect(store.getSnapshot().access).toEqual(access); expect(store.getSnapshot().snapshot).toBeNull(); expect(store.isSuspended()).toBe(true); expect(disk.clear).toHaveBeenCalledOnce();
    pending.resolve(response(snapshot("2"))); await Promise.resolve(); await Promise.resolve();
    expect(store.getSnapshot().snapshot).toBeNull(); expect(disk.write).not.toHaveBeenCalled(); expect(seen).not.toContain(null);
    unsubscribe(); await store.forget(); expect(store.getSnapshot().access).toBeNull();
  });
  it("동일 인증 버전 재확인도 비운 목록을 다시 조회하고 새 버전에는 옛 목록을 쓰지 않음", async () => {
    const disk = cache(), fetcher = vi.fn(async () => response()), store = new BoardStore(disk, fetcher as typeof fetch);
    await store.authorize(access); await store.refresh(); const before = fetcher.mock.calls.length;
    await store.forget({ keepShell: true }); await store.authorize(access); await store.refresh();
    expect(fetcher.mock.calls.length).toBeGreaterThan(before); expect(store.getSnapshot().snapshot?.authVersion).toBe(1);
    await store.forget({ keepShell: true }); fetcher.mockImplementation(async () => response({ ...snapshot(), authVersion: 2 }));
    await store.authorize({ ...access, authVersion: 2 }); await store.refresh();
    expect(store.getSnapshot().access?.authVersion).toBe(2); expect(store.getSnapshot().snapshot?.authVersion).toBe(2); store.suspend();
  });
  it("서버에서 저장한 장소를 전체 조회보다 먼저 표시·보관하고 목록 ETag는 유지", async () => {
    const pending = deferred<Response>(), disk = cache(snapshot());
    const store = new BoardStore(disk, vi.fn(() => pending.promise) as typeof fetch);
    await store.authorize(access); await Promise.resolve();
    const place = { ...snapshot().places[0], id: "p2", name: "새 식당" };
    expect(store.acceptSavedPlace({ boardId: "b1", authVersion: 1, revision: "2", place })).toBe(true);
    expect(store.getSnapshot().syncing).toBe(true);
    expect(store.getSnapshot().snapshot?.places.map(p => p.id)).toEqual(["p2", "p1"]);
    expect(store.getSnapshot().snapshot?.revision).toBe("1");
    expect(disk.write).toHaveBeenCalledWith(expect.objectContaining({ places: [place, snapshot().places[0]] }));
    store.suspend(); pending.resolve(response());
  });
  it("중복 장소는 서버 메모·상태·두 사람·원본 연결을 그대로 반영", async () => {
    const store = new BoardStore(cache(snapshot()), vi.fn(async () => new Response(null, { status: 304 })) as typeof fetch);
    await store.authorize(access); await store.refresh();
    const place = { ...snapshot().places[0], status: "visited" as const, memo: "창가", sharers: ["우리", "서로"], sources: [{ url: "https://www.instagram.com/p/ABC/", media_type: "post" }] };
    store.acceptSavedPlace({ boardId: "b1", authVersion: 1, revision: "2", place });
    expect(store.getSnapshot().snapshot?.places).toEqual([place]); store.suspend();
  });
  it("다른 보드·이전 PIN·낮은 버전·손상 응답·잠금 뒤 저장 응답은 캐시를 오염시키지 않음", async () => {
    const store = new BoardStore(cache(snapshot("5")), vi.fn(async () => new Response(null, { status: 304 })) as typeof fetch);
    await store.authorize(access); await store.refresh();
    const saved = { boardId: "b1", authVersion: 1, revision: "6", place: snapshot().places[0] };
    expect(store.acceptSavedPlace({ ...saved, boardId: "b2" })).toBe(false);
    expect(store.acceptSavedPlace({ ...saved, authVersion: 0 })).toBe(false);
    expect(store.acceptSavedPlace({ ...saved, revision: "4" })).toBe(false);
    expect(store.acceptSavedPlace({ ...saved, place: { ...saved.place, lat: NaN } })).toBe(false);
    expect(store.acceptSavedPlace(saved)).toBe(true);
    expect(store.acceptSavedPlace({ ...saved, revision: "5", place: { ...saved.place, memo: "이전 응답" } })).toBe(false);
    await store.forget(); expect(store.acceptSavedPlace(saved)).toBe(false);
    expect(store.getSnapshot().snapshot).toBeNull();
  });
  it("저장 전에 출발한 조회와 저장보다 낮은 변경 번호는 새 장소를 덮지 못함", async () => {
    const first = deferred<Response>(), second = deferred<Response>();
    const fetcher = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const store = new BoardStore(cache(snapshot()), fetcher as typeof fetch); await store.authorize(access); await Promise.resolve();
    const place = { ...snapshot().places[0], id: "p2" };
    store.acceptSavedPlace({ boardId: "b1", authVersion: 1, revision: "3", place });
    first.resolve(response(snapshot("1"))); await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    second.resolve(response(snapshot("2"))); await vi.waitFor(() => expect(store.getSnapshot().syncing).toBe(false));
    expect(store.getSnapshot().snapshot?.places).toContainEqual(place); store.suspend();
  });
  it("캐시를 먼저 보여주고 서버 연결 실패에도 기존 목록 유지", async () => {
    const pending = deferred<Response>(), disk = cache(snapshot());
    const store = new BoardStore(disk, vi.fn(() => pending.promise) as typeof fetch);
    await store.authorize(access);
    expect(store.getSnapshot().snapshot?.places[0].name).toBe("카페");
    pending.resolve(new Response("", { status: 503 })); await store.refresh();
    expect(store.getSnapshot().snapshot).toEqual(snapshot()); expect(store.getSnapshot().error).not.toBe("");
  });
  it("캐시 읽기·쓰기가 불가능해도 메모리와 서버 조회는 계속 동작", async () => {
    const disk = cache(); vi.mocked(disk.read).mockRejectedValue(Error("blocked")); vi.mocked(disk.write).mockRejectedValue(Error("quota"));
    const store = new BoardStore(disk, vi.fn(async () => response()) as typeof fetch);
    await store.authorize(access); await store.refresh();
    expect(store.getSnapshot().snapshot).toEqual(snapshot()); expect(store.getSnapshot().error).toBe("");
  });
  it("304에서는 기존 객체를 유지하고 본문 해석이나 캐시 덮어쓰기 없이 완료", async () => {
    const disk = cache(snapshot()), fetcher = vi.fn<typeof fetch>(async () => new Response(null, { status: 304 }));
    const store = new BoardStore(disk, fetcher as typeof fetch); await store.authorize(access); await store.refresh();
    expect(new Headers(fetcher.mock.calls[0][1]?.headers).get("If-None-Match")).toBe(snapshotEtag(snapshot()));
    expect(disk.write).not.toHaveBeenCalled(); expect(store.getSnapshot().snapshot).toEqual(snapshot());
    expect(snapshotEtag(snapshot())).toBe('"dm2:b1:1:1"');
  });
  it("연속 이벤트를 250ms에 한 번 조회로 묶음", async () => {
    vi.useFakeTimers(); const fetcher = vi.fn(async () => response()), store = new BoardStore(cache(), fetcher as typeof fetch);
    await store.authorize(access); await store.refresh(); const before = fetcher.mock.calls.length;
    store.schedule(); store.schedule(); store.schedule(); await vi.advanceTimersByTimeAsync(249); expect(fetcher).toHaveBeenCalledTimes(before);
    await vi.advanceTimersByTimeAsync(1); expect(fetcher).toHaveBeenCalledTimes(before + 1);
  });
  it("수정 전에 시작한 조회가 늦게 끝나도 성공한 메모를 덮지 않고 다시 조회", async () => {
    const first = deferred<Response>(), second = deferred<Response>();
    const fetcher = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const store = new BoardStore(cache(snapshot()), fetcher as typeof fetch);
    await store.authorize(access); await Promise.resolve();
    store.patchPlace("p1", { memo: "새 메모" });
    first.resolve(response(snapshot("1", "오래된 메모")));
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    expect(store.getSnapshot().snapshot?.places[0].memo).toBe("새 메모");
    second.resolve(response(snapshot("2", "새 메모"))); await vi.waitFor(() => expect(store.getSnapshot().syncing).toBe(false));
    expect(store.getSnapshot().snapshot?.revision).toBe("2"); store.suspend();
  });
  it("낮은 변경 번호 응답은 최신 캐시를 덮지 않음", async () => {
    const store = new BoardStore(cache(snapshot("8")), vi.fn(async () => response(snapshot("7"))) as typeof fetch);
    await store.authorize(access); await store.refresh(); expect(store.getSnapshot().snapshot?.revision).toBe("8");
  });
  it("삭제는 즉시 메모리·기기 저장소에 반영", async () => {
    const disk = cache(snapshot()), store = new BoardStore(disk, vi.fn(async () => new Response(null, { status: 304 })) as typeof fetch);
    await store.authorize(access); await store.refresh(); store.removePlace("p1");
    expect(store.getSnapshot().snapshot?.places).toEqual([]); expect(disk.write).toHaveBeenCalledWith(expect.objectContaining({ places: [] })); store.suspend();
  });
  it("잠금 이후 도착한 응답은 메모리와 디스크에 돌아오지 않음", async () => {
    const pending = deferred<Response>(), disk = cache(snapshot()), store = new BoardStore(disk, vi.fn(() => pending.promise) as typeof fetch);
    await store.authorize(access); await Promise.resolve(); await store.forget(); pending.resolve(response(snapshot("2"))); await Promise.resolve(); await Promise.resolve();
    expect(store.getSnapshot().access).toBeNull(); expect(store.getSnapshot().snapshot).toBeNull(); expect(disk.write).not.toHaveBeenCalled(); expect(disk.clear).toHaveBeenCalled();
  });
  it("다른 보드·인증 버전의 캐시를 표시하지 않음", async () => {
    const pending = deferred<Response>(), store = new BoardStore(cache(snapshot()), vi.fn(() => pending.promise) as typeof fetch);
    await store.authorize({ ...access, boardId: "b2", authVersion: 2 }); expect(store.getSnapshot().snapshot).toBeNull();
    pending.resolve(response()); await store.refresh(); expect(store.getSnapshot().snapshot).toBeNull(); expect(store.getSnapshot().error).not.toBe("");
  });
  it("손상된 캐시 구조와 만료된 세션을 거절", async () => {
    const old = snapshot(); delete (old.places[0] as Partial<typeof old.places[0]>).kakao_place_id;
    expect(isSnapshot(old)).toBe(false);
    expect(isSnapshot({ ...snapshot(), places: [{ id: "p1", name: "깨진 값" }] })).toBe(false);
    const disk = cache(snapshot()), store = new BoardStore(disk); const expired = vi.fn(); store.onUnauthorized = expired;
    await store.authorize({ ...access, expiresAt: "2000-01-01" }); expect(expired).toHaveBeenCalledOnce(); expect(disk.read).not.toHaveBeenCalled();
  });
  it("PIN 변경 전 Next.js 화면 정보가 새 인증 버전을 되돌리지 못함", async () => {
    const current = { ...snapshot(), authVersion: 2 };
    const store = new BoardStore(cache(current), vi.fn(async () => response(current)) as typeof fetch);
    await store.authorize({ ...access, authVersion: 2 }); await store.refresh(); await store.authorize(access);
    expect(store.getSnapshot().access?.authVersion).toBe(2); expect(store.getSnapshot().snapshot?.authVersion).toBe(2);
  });
});
