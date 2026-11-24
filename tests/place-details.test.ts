import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, reset, tables } from "./fakeDb";
vi.mock("@/lib/db", () => ({ db: () => fakeDb }));
import { apolloObjects, parseMenuPage, parsePlaceHome, parseSearch, pickCandidate, searchQuery, similarName } from "@/lib/naver-place";
import { isFresh, placeDetails } from "@/lib/place-details";
import { tokenHash } from "@/lib/pin";
import { GET as detailsRoute } from "@/app/api/places/[id]/details/route";

// 실제 네이버 모바일 페이지와 같은 구조를 줄인 표본입니다.
const searchHtml = `<script>{"PlaceListBusinessesItem:111":{"__typename":"PlaceListBusinessesItem","id":"111","name":"\\u003Cmark\\u003E토바\\u003C\\u002Fmark\\u003E","x":"126.9959124","y":"37.4863214","menus":["a 1"]},"PlaceListBusinessesItem:222":{"id":"222","name":"디자인토바","x":"126.983741","y":"37.4873992","note":"{괄호} \\"따옴표\\""}}</script>
<a href="https://m.place.naver.com/restaurant/333/home">카드</a>`;
const apollo = (state: object) => `<html><script>window.__APOLLO_STATE__ = ${JSON.stringify(state)};\nwindow.x=1;</script></html>`;
const home = (id: string, lat: number, lng: number, extra: Record<string, unknown> = {}) => apollo({
  [`PlaceDetailBase:${id}`]: { id, coordinate: { x: String(lng), y: String(lat) }, virtualPhone: "0507-1449-5005", phone: null },
  "PlaceDetailTopPhotoItem:v": { mediaFormat: "image", mediaSource: "visitor", originalUrl: "https://pup-review-phinf.pstatic.net/v.jpg", width: 10, height: 10 },
  "PlaceDetailTopPhotoItem:b": { mediaFormat: "image", mediaSource: "business", originalUrl: "https://ldb-phinf.pstatic.net/b.jpg", width: 1206, height: 1213 },
  "PlaceDetailTopPhotoItem:clip": { mediaFormat: "video", mediaSource: "clip", originalUrl: "https://ldb-phinf.pstatic.net/c.jpg" },
  "PlaceDetailTopPhotoItem:evil": { mediaFormat: "image", mediaSource: "business", originalUrl: "https://evil.example/x.jpg" },
  "Menu:1": { name: "TOVA deep (90분)", price: "75000", index: 1 }, "Menu:0": { name: "TOVA signature (90분)", price: "89000", index: 0 },
  ROOT_QUERY: { [`placeDetail({"input":{"id":"${id}"}})`]: {
    topPhotos: { items: [{ __ref: "PlaceDetailTopPhotoItem:v" }, { __ref: "PlaceDetailTopPhotoItem:clip" }, { __ref: "PlaceDetailTopPhotoItem:b" }, { __ref: "PlaceDetailTopPhotoItem:evil" }] },
    phoneInfo: { phone: "0507-1449-5005" }, naverBooking: { naverBookingUrl: "https://m.booking.naver.com/booking/12/bizes/1683877" },
    newBusinessHours: [{ businessStatusDescription: { status: "영업 중", description: "20:40에 영업 종료" }, businessHours: [{ day: "화", businessHours: { start: "09:00", end: "20:40" }, breakHours: [{ start: "15:00", end: "16:00" }] }] }],
    ...extra,
  } },
});

describe("네이버 페이지 읽기", () => {
  it("문자열 속 괄호·따옴표가 있어도 객체를 정확히 꺼내고, 목록 후보와 단일 카드 링크를 모은다", () => {
    expect(apolloObjects(searchHtml, "PlaceListBusinessesItem")).toHaveLength(2);
    expect(parseSearch(searchHtml)).toEqual([
      { id: "111", name: "토바", lat: 37.4863214, lng: 126.9959124 },
      { id: "222", name: "디자인토바", lat: 37.4873992, lng: 126.983741 },
      { id: "333", name: null, lat: null, lng: null },
    ]);
  });
  it("가게 등록 사진을 먼저, 영상·외부 주소는 빼고, 메뉴는 순서대로 원 단위로 바꾼다", () => {
    const place = parsePlaceHome(home("111", 37.4863214, 126.9959124), "111")!;
    expect(place.photos.map((p) => p.url)).toEqual(["https://ldb-phinf.pstatic.net/b.jpg", "https://pup-review-phinf.pstatic.net/v.jpg"]);
    expect(place.menus).toEqual([{ name: "TOVA signature (90분)", price: "89,000원" }, { name: "TOVA deep (90분)", price: "75,000원" }]);
    expect(place).toMatchObject({ phone: "0507-1449-5005", bookingUrl: "https://m.booking.naver.com/booking/12/bizes/1683877", needsMenuPage: false,
      hours: { status: "영업 중", description: "20:40에 영업 종료", days: [{ day: "화", open: "09:00", close: "20:40", breaks: ["15:00~16:00"], note: null }] } });
  });
  it("음식점 메뉴 탭과 형식이 바뀐 페이지를 안전하게 처리한다", () => {
    expect(parseMenuPage(apollo({ "PlaceMenuItem:a": { name: "Dinner menu", price: { displayText: "420,000원" } } }))).toEqual([{ name: "Dinner menu", price: "420,000원" }]);
    expect(parsePlaceHome("<html>바뀐 페이지</html>", "1")).toBeNull();
    expect(parseMenuPage("<html></html>")).toEqual([]);
  });
  it("같은 가게 고르기: 150m 안에서 이름이 비슷하거나 30m 안, 가장 가까운 곳", () => {
    const c = parseSearch(searchHtml);
    expect(pickCandidate(c, { name: "토바", lat: 37.4863214, lng: 126.9959124 })?.id).toBe("111");
    expect(pickCandidate(c, { name: "전혀 다른 가게", lat: 37.4866, lng: 126.9959 })).toBeNull();
    expect(similarName("스타벅스 방배점", "스타벅스")).toBe(true);
    expect(searchQuery("밍글스", "서울 강남구 도산대로67길 19")).toBe("밍글스 강남구");
  });
});

describe("가게 정보 캐시", () => {
  const target = { kakao_place_id: "k1", name: "토바", address: "서울 서초구 방배로22길 20", lat: 37.4863214, lng: 126.9959124 };
  const fetcher = (opts: { naver?: "ok" | "fail" | "none"; kakaoPhone?: string | null } = {}) => vi.fn(async (url: string) => {
    if (url.includes("dapi.kakao.com")) return new Response(JSON.stringify({ documents: opts.kakaoPhone ? [{ id: "k1", phone: opts.kakaoPhone }] : [] }));
    if (opts.naver === "fail") return new Response("blocked", { status: 403 });
    if (url.includes("m.search.naver.com")) return new Response(opts.naver === "none" ? "<html>결과 없음</html>" : searchHtml);
    if (url.includes("/place/111/home")) return new Response(home("111", 37.4863214, 126.9959124));
    return new Response("", { status: 404 });
  });
  beforeEach(() => { reset(); vi.stubEnv("KAKAO_REST_API_KEY", "k"); tables.place_details = []; vi.spyOn(console, "warn").mockImplementation(() => {}); });

  it("처음엔 네이버에서 읽어 저장하고, 7일 안에는 다시 읽지 않는다", async () => {
    const f = fetcher({ kakaoPhone: "02-123-4567" });
    const first = await placeDetails(target, f as unknown as typeof fetch);
    expect(first).toMatchObject({ status: "ok", naver_place_id: "111", naver_url: "https://m.place.naver.com/place/111/home", phone: "02-123-4567", catchtable_url: null });
    expect(first.photos).toHaveLength(2);
    const calls = f.mock.calls.length;
    await placeDetails(target, f as unknown as typeof fetch);
    expect(f.mock.calls.length).toBe(calls);
    expect(isFresh({ status: "ok", fetched_at: first.fetched_at }, Date.now() + 8 * 86400e3)).toBe(false);
  });
  it("네이버가 막히면 카카오 전화번호만이라도, 둘 다 없으면 오류로 짧게 캐시하고 예전 성공 정보는 덮어쓰지 않는다", async () => {
    expect(await placeDetails(target, fetcher({ naver: "fail", kakaoPhone: "02-1" + "23-4567" }) as unknown as typeof fetch)).toMatchObject({ status: "ok", phone: "02-123-4567", photos: [] });
    tables.place_details = [{ kakao_place_id: "k1", status: "ok", naver_place_id: "111", phone: "0507", photos: [{ url: "https://ldb-phinf.pstatic.net/b.jpg" }], menus: [], hours: null, booking_url: null, catchtable_url: null, fetched_at: "2000-01-01T00:00:00Z" }];
    const stale = await placeDetails(target, fetcher({ naver: "fail" }) as unknown as typeof fetch);
    expect(stale).toMatchObject({ status: "ok", naver_place_id: "111" });
    expect(tables.place_details[0].fetched_at).toBe("2000-01-01T00:00:00Z");
  });
  it("검색 결과에 같은 가게가 없으면 못 찾음으로 저장한다", async () => {
    expect((await placeDetails(target, fetcher({ naver: "none" }) as unknown as typeof fetch)).status).toBe("not_found");
    expect(tables.place_details[0].status).toBe("not_found");
  });
  it("같은 장소를 동시에 열어도 네이버는 한 번만 읽는다", async () => {
    const f = fetcher();
    await Promise.all([placeDetails(target, f as unknown as typeof fetch), placeDetails(target, f as unknown as typeof fetch)]);
    expect(f.mock.calls.filter(([u]) => String(u).includes("m.search.naver.com"))).toHaveLength(1);
  });
});

describe("가게 정보 API", () => {
  const token = "a".repeat(64);
  beforeEach(() => {
    reset();
    tables.boards = [{ id: "b1", name: "우리", member_names: ["유빈"], auth_version: 1 }];
    tables.access_sessions = [{ token_hash: tokenHash(token), board_id: "b1", purpose: "member", member_name: "유빈", remember: true, auth_version: 1, expires_at: "2030-01-01T00:00:00Z" }];
    tables.places = [{ id: "p-other", board_id: "b2", kakao_place_id: "k9", name: "남의 장소", lat: 37, lng: 127, deleted_at: null }];
    tables.place_details = [];
  });
  it("로그인이 필요하고, 다른 폴더의 장소는 없는 장소로 다룬다", async () => {
    const req = (cookie: string) => new Request("http://localhost/api/places/p-other/details", { headers: { cookie } });
    expect((await detailsRoute(req(""), { params: Promise.resolve({ id: "p-other" }) })).status).toBe(401);
    expect((await detailsRoute(req(`datemap_session=${token}`), { params: Promise.resolve({ id: "p-other" }) })).status).toBe(404);
  });
});
