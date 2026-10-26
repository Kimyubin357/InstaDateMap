import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, failNext, reset, tables } from "./fakeDb";
import { tokenHash } from "@/lib/pin";

vi.mock("@/lib/db", () => ({ db: () => fakeDb }));
vi.mock("@/lib/instagram", async (orig) => ({ ...await orig<typeof import("@/lib/instagram")>(), fetchCaption: vi.fn(async () => ({ caption: "도나스데이 수원본점", method: "og", locationTag: "경기도 수원" })) }));
vi.mock("@/lib/llm", async (orig) => ({ ...await orig<typeof import("@/lib/llm")>(), callLlm: vi.fn(async () => JSON.stringify({ places: [{ name: "도나스데이", branch: "수원본점", address: "경기도 수원시 권선구 서수원로 174-2", area_hint: "수원", confidence: 0.9 }] })) }));
vi.mock("@/lib/kakao", async (orig) => ({ ...await orig<typeof import("@/lib/kakao")>(), keywordSearch: vi.fn(async () => [{ kakao_place_id: "978669489", name: "도나스데이 본점", address: "경기 수원시 권선구 서수원로 174-2", lat: 37.24, lng: 126.97, category: "카페", kakao_url: "https://place.map.kakao.com/978669489" }]), resolveCandidate: vi.fn(async () => [
  { kakao_place_id: "978669489", name: "도나스데이 본점", address: "경기 수원시 권선구 서수원로 174-2", lat: 37.24, lng: 126.97, category: "카페", kakao_url: "https://place.map.kakao.com/978669489" },
  { kakao_place_id: "other", name: "도나스데이 본점", address: "경기 용인시 기흥구 구성로 160", lat: 37.29, lng: 127.12, category: "카페", kakao_url: "" },
]) }));

import { POST } from "@/app/api/share/route";
import { GET, POST as saveDirect } from "@/app/api/places/route";
import { readShareResponse } from "@/lib/share-stream";
import { withSavedPlace } from "@/lib/saved-place-server";
import { POST as confirm } from "@/app/api/sources/[id]/confirm/route";

const request = (body: unknown, token = "tok") => new Request("http://localhost/api/share", { method: "POST", headers: { "content-type": "application/json", cookie: `datemap_session=${token === "tok" ? "a".repeat(64) : token}`, origin: "http://localhost" }, body: JSON.stringify(body === null ? null : { work_id: "10000000-0000-4000-8000-000000000001", ...(body as object) }) });
beforeEach(() => { reset(); tables.boards = [{ id: "b1", name: "테스트", token: "tok", auth_version: 1, member_names: ["테스트", "연인"] }]; tables.access_sessions = [{ token_hash: tokenHash("a".repeat(64)), board_id: "b1", purpose: "member", member_name: "테스트", auth_version: 1, expires_at: "2030-01-01T00:00:00Z" }]; });

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
    const { message } = await res.json();
    expect(message).toContain("잠시 후 다시 시도");
    expect(message).not.toContain("데이터베이스");
  });
  it("연결 기록 저장 실패는 재시도 주소와 실패 상태를 반환", async () => {
    failNext("source_places", "upsert");
    const res = await POST(request({ url: "https://www.instagram.com/reel/Deo7JHEpCXN/" }));
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ status: "error", confirm_url: expect.stringContaining("/confirm/") });
  });
  it("목록 DB 장애를 빈 지도로 표시하지 않음", async () => {
    failNext("places", "select");
    const res = await GET(new Request("http://localhost/api/places", { headers: { cookie: `datemap_session=${"a".repeat(64)}` } }));
    expect(res.status).toBe(500);
    expect((await res.json()).message).toContain("불러오지 못했어요");
  });
  it("지도 목록 응답도 브라우저 캐시를 금지", async () => {
    const res = await GET(new Request("http://localhost/api/places", { headers: { cookie: `datemap_session=${"a".repeat(64)}` } }));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});


describe("직접 저장과 세션 저장자", () => {
  const body = { query: "도나스데이 수원본점", place_id: "978669489", who: "위조한 이름" };
  it("저장 응답에 실제 DB 장소·저장자를 담고 중복 저장은 기존 상태와 메모 유지", async () => {
    const first = await (await saveDirect(request(body))).json();
    expect(first.saved_place).toMatchObject({ boardId: "b1", authVersion: 1, place: { id: tables.places[0].id, name: "도나스데이 본점", sharers: ["테스트"], sources: [] } });
    tables.places[0].status = "visited"; tables.places[0].memo = "창가"; tables.access_sessions[0].member_name = "연인";
    const second = await (await saveDirect(request(body))).json();
    expect(second.saved_place.place).toMatchObject({ status: "visited", memo: "창가", sharers: ["테스트", "연인"] });
  });
  it("확인 후 저장과 스트리밍 링크 저장 모두 지도에 바로 쓸 장소 정보를 제공", async () => {
    const shared = await readShareResponse(await POST(request({ url: "https://www.instagram.com/reel/Deo7JHEpCXN/", stream: true })), () => {});
    expect(shared.saved_place?.place).toMatchObject({ name: "도나스데이 본점", sources: [{ url: "https://www.instagram.com/reel/Deo7JHEpCXN/", media_type: "reel" }] });
    Object.assign(tables.sources[0], { status: "needs_review", work_owner: `${tokenHash("a".repeat(64))}:10000000-0000-4000-8000-000000000001`, work_until: new Date(Date.now()+90000).toISOString() });
    const res = await confirm(request({ selections: [], version: tables.sources[0].analysis_version, direct: { place_id: "978669489", query: "도나스데이" } }), { params: Promise.resolve({ id: tables.sources[0].id }) });
    expect((await res.json()).saved_place).toMatchObject({ boardId: "b1", authVersion: 1, place: { sharers: ["테스트"] } });
  });
  it("저장 후 미리보기 조회 장애는 저장 실패로 바꾸지 않으며 다른 보드 장소를 노출하지 않음", async () => {
    const saved = await (await saveDirect(request(body))).json();
    const board = { id: "b1", authVersion: 1 } as import("@/lib/auth").Board;
    failNext("place_saves", "select"); expect(await withSavedPlace(board, { place_url: saved.place_url })).toEqual({ place_url: saved.place_url });
    tables.places[0].board_id = "b2";
    expect(await withSavedPlace(board, { place_url: saved.place_url })).toEqual({ place_url: saved.place_url });
  });
  it("링크 없이 저장하고 두 사람이 다시 저장하면 병합", async () => {
    const first = await saveDirect(request(body)); expect(first.status).toBe(200);
    expect((await first.json()).status).toBe("saved");
    expect(tables.sources ?? []).toHaveLength(0); expect(tables.source_places ?? []).toHaveLength(0);
    expect(tables.place_saves[0].added_by).toBe("테스트");
    tables.access_sessions[0].member_name = "연인";
    const second = await saveDirect(request(body)); expect((await second.json()).status).toBe("duplicate");
    const list = await GET(new Request("http://localhost/api/places", { headers: { cookie: `datemap_session=${"a".repeat(64)}` } }));
    const saved = await list.json(); expect(saved.places).toHaveLength(1); expect(saved.places[0].sharers).toHaveLength(2); expect(saved.places[0].sources).toHaveLength(0);
  });
  it("직접 저장한 장소를 링크로 또 저장해도 메모와 상태를 보존", async () => {
    await saveDirect(request(body)); tables.places[0].status = "visited"; tables.places[0].memo = "창가";
    await POST(request({ url: "https://www.instagram.com/reel/Deo7JHEpCXN/", who: "위조" }));
    expect(tables.places).toHaveLength(1); expect(tables.places[0]).toMatchObject({ status: "visited", memo: "창가" });
    expect(tables.source_places[0].added_by).toBe("테스트");
  });
  it("검색 결과에 없는 ID는 저장하지 않음", async () => {
    const res = await saveDirect(request({ ...body, place_id: "forged" })); expect(res.status).toBe(409); expect(tables.places ?? []).toHaveLength(0);
  });
  it("트랜잭션 실패 시 고아 장소가 남지 않음", async () => {
    failNext("place_saves", "upsert"); const res = await saveDirect(request(body)); expect(res.status).toBe(500); expect(tables.places ?? []).toHaveLength(0);
  });
  it("이름을 선택하지 않은 기기는 저장할 수 없음", async () => {
    tables.access_sessions[0].member_name = null; expect((await saveDirect(request(body))).status).toBe(409); expect(tables.places ?? []).toHaveLength(0);
  });
  it("진행 상태는 실제 처리 순서와 완료 결과를 스트리밍", async () => {
    const res = await POST(request({ url: "https://www.instagram.com/reel/Deo7JHEpCXN/", stream: true }));
    const stages: string[] = []; const saved = await readShareResponse(res, s => stages.push(s));
    expect(stages).toEqual(["caption", "extract", "search", "save"]); expect(saved.status).toBe("saved"); expect(saved.place_url).toContain("/?place=");
  });
});

it.each([{ caption: "수동 붙여넣기" }, { images: ["data:image/png;base64,iVBOR"] }, { images: "malformed" }])("retired upload inputs are rejected before creating a source: %j", async (input) => {
  const response = await POST(request({ url: "https://www.instagram.com/p/RETIRED/", ...input }));
  expect(response.status).toBe(400); expect((await response.json()).message).toContain("인스타 주소나 장소 직접 검색");
  expect(tables.sources ?? []).toHaveLength(0); expect(tables.places ?? []).toHaveLength(0);
});
