import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, failNext, reset, tables } from "./fakeDb";

vi.mock("@/lib/db", () => ({ db: () => fakeDb }));
vi.mock("@/lib/instagram", async (orig) => ({ ...await orig<typeof import("@/lib/instagram")>(), fetchCaption: vi.fn(async () => ({ caption: "도나스데이 수원본점", method: "og", locationTag: "경기도 수원" })) }));
vi.mock("@/lib/llm", async (orig) => ({ ...await orig<typeof import("@/lib/llm")>(), callLlm: vi.fn(async () => JSON.stringify({ places: [{ name: "도나스데이", branch: "수원본점", address: "경기도 수원시 권선구 서수원로 174-2", area_hint: "수원", confidence: 0.9 }] })) }));
vi.mock("@/lib/kakao", async (orig) => ({ ...await orig<typeof import("@/lib/kakao")>(), resolveCandidate: vi.fn(async () => [
  { kakao_place_id: "978669489", name: "도나스데이 본점", address: "경기 수원시 권선구 서수원로 174-2", lat: 37.24, lng: 126.97, category: "카페", kakao_url: "https://place.map.kakao.com/978669489" },
  { kakao_place_id: "other", name: "도나스데이 본점", address: "경기 용인시 기흥구 구성로 160", lat: 37.29, lng: 127.12, category: "카페", kakao_url: "" },
]) }));

import { POST } from "@/app/api/share/route";
import { GET } from "@/app/api/places/route";

const request = (body: unknown, token = "tok") => new Request("http://localhost/api/share", { method: "POST", headers: { "content-type": "application/json", "x-board-token": token }, body: JSON.stringify(body) });
beforeEach(() => { reset(); tables.boards = [{ id: "b1", name: "테스트", token: "tok" }]; });

describe("공유 HTTP API", () => {
  it("실패했던 링크 입력 → 캡션·지역 태그 → 주소 검증 → DB 저장까지 연결", async () => {
    const res = await POST(request({ url: "https://www.instagram.com/reel/Deo7JHEpCXN/?xtok=test", who: "테스트" }));
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("saved");
    expect(tables.places[0]).toMatchObject({ kakao_place_id: "978669489" });
    expect(tables.source_places).toHaveLength(1);
    expect(tables.sources[0]).toMatchObject({ status: "done", url: "https://www.instagram.com/reel/Deo7JHEpCXN/" });
  });
  it("토큰이 틀리면 쓰기 없이 거절", async () => {
    expect((await POST(request({ url: "https://www.instagram.com/p/ABC/" }, "wrong"))).status).toBe(401);
    expect(tables.sources ?? []).toHaveLength(0);
  });
  it("잘못된 링크와 null JSON은 400", async () => {
    expect((await POST(request({ url: "https://example.com" }))).status).toBe(400);
    expect((await POST(request(null))).status).toBe(400);
  });
  it("DB 인증 조회 장애를 잘못된 토큰으로 오인하지 않음", async () => {
    failNext("boards", "select");
    const res = await POST(request({ url: "https://www.instagram.com/p/ABC/" }));
    expect(res.status).toBe(500);
    expect((await res.json()).message).toContain("데이터베이스");
  });
  it("연결 기록 저장 실패는 재시도 주소와 실패 상태를 반환", async () => {
    failNext("source_places", "upsert");
    const res = await POST(request({ url: "https://www.instagram.com/reel/Deo7JHEpCXN/" }));
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ status: "error", confirm_url: expect.stringContaining("/confirm/") });
  });
  it("목록 DB 장애를 빈 지도로 표시하지 않음", async () => {
    failNext("places", "select");
    const res = await GET(new Request("http://localhost/api/places", { headers: { "x-board-token": "tok" } }));
    expect(res.status).toBe(500);
    expect((await res.json()).message).toContain("불러오지 못했어요");
  });
  it("지도 목록 응답도 브라우저 캐시를 금지", async () => {
    const res = await GET(new Request("http://localhost/api/places", { headers: { "x-board-token": "tok" } }));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});
