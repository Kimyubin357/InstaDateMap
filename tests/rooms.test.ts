import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { groupByShop, membersLabel, newPlacesByRoom, readScope, roomShares, shopKey, splitColors, timeAgo, writeScope, type AllPlace } from "@/lib/rooms";
import { isNewPlace, NEW_PLACE_WINDOW, pruneSeen, readSeenLog, writeSeenLog } from "@/lib/new-places";
import { RoomsStore } from "@/lib/rooms-store";

const place = (id: string, board_id: string, extra: Partial<AllPlace> = {}): AllPlace => ({
  id, board_id, name: "어니언 성수", address: "서울 성동구", lat: 37.5446, lng: 127.0581, category: "카페", kakao_place_id: "onion", kakao_url: null,
  status: "wish", memo: null, sharers: ["유빈"], sources: [], created_at: "2026-11-25T00:00:00Z", last_saved_at: "2026-11-25T00:00:00Z", ...extra,
});

function memoryStorage() {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); }, removeItem: (k: string) => { data.delete(k); }, clear: () => data.clear() };
}

describe("전체 보기 지도: 같은 가게는 핀 하나", () => {
  it("카카오 장소 id가 같으면 묶고, 방 순서는 내 방 목록을 따른다. 대표는 이 기기가 연 방의 것", () => {
    const places = [place("a", "ours"), place("b", "mine", { last_saved_at: "2026-11-26T00:00:00Z" }), place("c", "ours", { kakao_place_id: "other", name: "고코" })];
    const grouped = groupByShop(places, ["mine", "ours"], "ours");
    expect(grouped).toHaveLength(2);
    const onion = grouped.find((g) => g.kakao_place_id === "onion")!;
    expect(onion).toMatchObject({ id: "a", board_id: "ours", room_ids: ["mine", "ours"], group_ids: ["a", "b"] });
    // 연 방에 없으면 가장 최근에 저장한 방의 것
    expect(groupByShop(places, ["mine", "ours"], "jeju").find((g) => g.kakao_place_id === "onion")!.id).toBe("b");
    expect(grouped.find((g) => g.name === "고코")).toMatchObject({ room_ids: ["ours"], group_ids: ["c"] });
  });

  it("카카오 id가 없으면 이름과 좌표(약 1m)가 같을 때만 같은 가게", () => {
    const a = place("a", "x", { kakao_place_id: null }), b = place("b", "y", { kakao_place_id: null, lat: 37.544601 }), c = place("c", "y", { kakao_place_id: null, lat: 37.5450 });
    expect(shopKey(a)).toBe(shopKey(b));
    expect(shopKey(a)).not.toBe(shopKey(c));
  });

  it("지역 카드 비율 막대: 두 방에 있는 가게는 두 방 모두에 세고, 방 목록 순서로", () => {
    expect(roomShares([{ ...place("a", "ours"), room_ids: ["ours", "mine"] }, { ...place("c", "ours"), room_ids: ["ours"] }], ["mine", "ours"]))
      .toEqual([["mine", 1], ["ours", 2]]);
  });

  it("색 나누기: 하나면 그 색, 여럿이면 같은 비율의 원, 모르는 색은 빨강", () => {
    expect(splitColors(["teal"])).toBe("var(--palette-teal)");
    expect(splitColors([])).toBe("var(--palette-red)");
    expect(splitColors(["red", "forest"])).toBe("conic-gradient(var(--palette-red) 0.00% 50.00%,var(--palette-forest) 50.00% 100.00%)");
    expect(splitColors(["purple"])).toBe("var(--palette-red)");
  });

  it("멤버 수 표시와 지난 시간", () => {
    expect(membersLabel(1)).toBe("나만"); expect(membersLabel(4)).toBe("4명");
    const now = Date.parse("2026-11-25T12:00:00Z");
    expect(timeAgo("2026-11-25T11:59:40Z", now)).toBe("방금");
    expect(timeAgo("2026-11-25T11:48:00Z", now)).toBe("12분 전");
    expect(timeAgo("2026-11-25T10:00:00Z", now)).toBe("2시간 전");
    expect(timeAgo("2026-11-24T10:00:00Z", now)).toBe("어제");
    expect(timeAgo("2026-11-21T10:00:00Z", now)).toBe("4일 전");
  });
});

describe("새 장소 시트와 NEW 규칙", () => {
  it("새 장소가 있는 방만, 내 방 목록 순서로, 방 안에서는 최근 것부터", () => {
    const places = [place("a", "ours", { created_at: "2026-11-25T01:00:00Z" }), place("b", "ours", { created_at: "2026-11-25T03:00:00Z" }), place("c", "jeju"), place("d", "mine")];
    const entries = newPlacesByRoom(places, new Set(["a", "b", "c"]), [{ id: "mine" }, { id: "jeju" }, { id: "ours" }]);
    expect(entries.map((e) => [e.room, e.places.map((p) => p.id)])).toEqual([["jeju", ["c"]], ["ours", ["b", "a"]]]);
  });

  it("보면 바로 NEW가 아니고, 안 봐도 24시간이 지나면 NEW가 아니다", () => {
    const now = Date.parse("2026-11-25T12:00:00Z"), created = new Date(now - 1000).toISOString();
    expect(isNewPlace(created, now)).toBe(true);
    expect(isNewPlace(created, now, "wish", true)).toBe(false);
    expect(isNewPlace(new Date(now - NEW_PLACE_WINDOW).toISOString(), now, "wish", false)).toBe(false);
  });

  it("이 기기의 본 기록은 이틀 지나면 버린다", () => {
    const now = Date.parse("2026-11-25T12:00:00Z");
    expect(pruneSeen({ a: now - 1000, b: now - 3 * NEW_PLACE_WINDOW, c: Number.NaN }, now)).toEqual({ a: now - 1000 });
  });
});

describe("기기에 기억하는 범위와 본 기록", () => {
  beforeEach(() => { vi.stubGlobal("localStorage", memoryStorage()); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("처음에는 전체, 고른 범위는 계정마다 기억한다", () => {
    expect(readScope("u1")).toBe("all");
    writeScope("u1", "room");
    expect(readScope("u1")).toBe("room");
    expect(readScope("u2")).toBe("all");
    expect(readScope(null)).toBe("all");
  });

  it("본 기록을 읽고 쓰며, 깨진 값은 빈 기록으로 본다", () => {
    writeSeenLog("u1", { a: Date.now() });
    expect(Object.keys(readSeenLog("u1"))).toEqual(["a"]);
    localStorage.setItem("datemap-seen:u2", "[1,2]");
    expect(readSeenLog("u2")).toEqual({});
  });
});

describe("RoomsStore", () => {
  beforeEach(() => { vi.stubGlobal("localStorage", memoryStorage()); });
  afterEach(() => { vi.unstubAllGlobals(); });
  const json = (body: unknown, init: ResponseInit = {}) => new Response(body === null ? null : JSON.stringify(body), { status: 200, ...init, headers: { "Content-Type": "application/json", ...(init.headers ?? {}) } });
  const room = { id: "ours", name: "우리", color: "red", role: "owner", member_name: "유빈", member_count: 2, member_limit: 8, place_count: 1, collection_count: 0, member_ids: [], member_names: [] };

  it("전체일 때 모든 방 장소를 받고, 같으면 ETag로 304를 받아 그대로 둔다", async () => {
    const calls: { url: string; headers: Record<string, string> }[] = [];
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
      if (url === "/api/rooms") return json({ current: "ours", rooms: [room] });
      if (url === "/api/places/seen") return json({ ids: ["seen-on-server"] });
      if (url === "/api/places/all") return calls.filter((c) => c.url === url).length > 1 ? new Response(null, { status: 304 }) : json({ current: "ours", rooms: [room], places: [place("a", "ours")] }, { headers: { ETag: '"all1:x"' } });
      return json({}, { status: 404 });
    }) as unknown as typeof fetch;
    const store = new RoomsStore(fetcher);
    store.bind("u1");
    await store.loadAll(); await vi.waitFor(() => expect(store.getSnapshot().seen.has("seen-on-server")).toBe(true));
    expect(store.getSnapshot()).toMatchObject({ scope: "all", current: "ours", allError: "" });
    expect(store.getSnapshot().all?.map((p) => p.id)).toEqual(["a"]);
    await store.loadAll();
    expect(calls.filter((c) => c.url === "/api/places/all").at(-1)?.headers).toEqual({ "If-None-Match": '"all1:x"' });
    expect(store.getSnapshot().all?.map((p) => p.id)).toEqual(["a"]);
  });

  it("방 하나를 고르면 전체 장소를 받지 않고, 그 선택을 기억한다", async () => {
    const fetcher = vi.fn(async (url: string) => url === "/api/rooms" ? json({ current: "ours", rooms: [room] }) : json({ ids: [] })) as unknown as typeof fetch;
    const first = new RoomsStore(fetcher);
    first.bind("u1"); first.setScope("room");
    expect(readScope("u1")).toBe("room");
    // 다음에 열 때(같은 기기) 방 하나로 열고, 전체 장소는 받지 않는다
    const next = new RoomsStore(fetcher);
    next.bind("u1");
    expect(next.getSnapshot().scope).toBe("room");
    await vi.waitFor(() => expect(next.getSnapshot().rooms).toHaveLength(1));
    const allCalls = (fetcher as unknown as ReturnType<typeof vi.fn>).mock.calls.filter(([url]) => url === "/api/places/all").length;
    expect(allCalls).toBe(1); // 처음 계정을 열 때(기본값 전체) 한 번뿐
  });

  it("본 장소는 바로 화면에서 빼고 서버에 한 번만 보낸다(기기에도 남김)", async () => {
    const posts: unknown[] = [];
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => { if (init?.method === "POST") posts.push(JSON.parse(String(init.body))); return json(url === "/api/rooms" ? { current: null, rooms: [] } : { ids: [] }); }) as unknown as typeof fetch;
    const store = new RoomsStore(fetcher);
    store.bind("u1"); store.setScope("room");
    store.markSeen(["a", "b"]); store.markSeen(["a"]);
    expect([...store.getSnapshot().seen].sort()).toEqual(["a", "b"]);
    await vi.waitFor(() => expect(posts).toEqual([{ ids: ["a", "b"] }]));
    expect(Object.keys(readSeenLog("u1")).sort()).toEqual(["a", "b"]);
  });

  it("다른 방 장소를 고치거나 지우면 전체 목록에 바로 보인다", async () => {
    const fetcher = vi.fn(async (url: string) => url === "/api/places/all" ? json({ current: "ours", rooms: [room], places: [place("a", "ours"), place("b", "jeju")] }) : json(url === "/api/rooms" ? { current: "ours", rooms: [room] } : { ids: [] })) as unknown as typeof fetch;
    const store = new RoomsStore(fetcher);
    store.bind("u1"); await store.loadAll();
    store.patchPlace("b", { memo: "메모" });
    expect(store.getSnapshot().all?.find((p) => p.id === "b")?.memo).toBe("메모");
    store.removePlace("a");
    expect(store.getSnapshot().all?.map((p) => p.id)).toEqual(["b"]);
  });
});
